import type {
  ClientPerspective,
  ContentSourceMapDocuments,
  QueryParams,
  SanityClient,
} from '@sanity/client'
import { SanityStegaClient, stegaEncodeSourceMap } from '@sanity/client/stega'
import { ChannelReturns, createChannel } from 'channels'
import { listenKeys, map, MapStore, onMount, WritableAtom } from 'nanostores'
import {
  type VisualEditingConnectionIds,
  type VisualEditingMsg,
} from 'visual-editing-helpers'

import { LiveModeState, QueryStoreState } from '../types'

export interface CreateLiveModeStoreOptions {
  /**
   * The origin that are allowed to connect to the overlay.
   * If left unspecified it will default to the current origin, and the Studio will have to be hosted by the same origin.
   * @example `https://my.sanity.studio`
   * @defaultValue `location.origin`
   */
  allowStudioOrigin: string
  client: SanityClient | SanityStegaClient
  $perspective: WritableAtom<ClientPerspective>
}

export function createLiveModeStore(options: CreateLiveModeStoreOptions): {
  $LiveMode: MapStore<LiveModeState>
  runLiveFetch: <Response, Error>(
    query: string,
    params: QueryParams,
    $fetch: MapStore<QueryStoreState<Response, Error>>,
    controller: AbortController,
  ) => Promise<void>
} {
  const { client, allowStudioOrigin = '/', $perspective } = options
  const { projectId, dataset } = client.config()

  let channel: ChannelReturns<VisualEditingMsg> | null = null

  const initialLiveMode = {
    enabled: false,
    connected: false,
    studioOrigin: options.allowStudioOrigin,
  } satisfies LiveModeState
  const $LiveMode = map<LiveModeState>(initialLiveMode)

  const cache = new Map()

  if (typeof document !== 'undefined') {
    onMount($LiveMode, () => {
      $LiveMode.setKey('enabled', true)
      const targetOrigin = new URL(allowStudioOrigin, location.origin).origin
      $LiveMode.setKey('studioOrigin', targetOrigin)
      channel = createChannel<VisualEditingMsg>({
        id: 'loaders' satisfies VisualEditingConnectionIds,
        onStatusUpdate(status) {
          if (status === 'connected') {
            $LiveMode.setKey('connected', true)
          } else if (status === 'disconnected' || status === 'unhealthy') {
            $LiveMode.setKey('connected', false)
          }
        },
        connections: [
          {
            target: parent,
            targetOrigin,
            id: 'presentation' satisfies VisualEditingConnectionIds,
          },
        ],
        handler: (type, data) => {
          if (
            type === 'loader/perspective' &&
            data.projectId === projectId &&
            data.dataset === dataset
          ) {
            $perspective.set(data.perspective)
            updateLiveQueries()
          } else if (
            type === 'loader/query-change' &&
            data.projectId === projectId &&
            data.dataset === dataset
          ) {
            const { perspective, query, params } = data
            if (
              client instanceof SanityStegaClient &&
              client.config().stega.enabled &&
              data.resultSourceMap
            ) {
              cache.set(JSON.stringify({ perspective, query, params }), {
                ...data,
                result: stegaEncodeSourceMap(
                  data.result,
                  data.resultSourceMap,
                  client.config().stega,
                  { projectId: data.projectId, dataset: data.dataset },
                ),
              })
            } else {
              cache.set(JSON.stringify({ perspective, query, params }), data)
            }

            updateLiveQueries()
          }
        },
      })

      const unlistenConnection = listenKeys($LiveMode, ['connected'], () => {
        // @TODO handle reconnection and invalidation
        // Revalidate if the connection status changes
        // invalidateKeys(() => true)
      })

      return () => {
        unlistenConnection()
        $LiveMode.setKey('enabled', false)
        $LiveMode.setKey('connected', false)
        channel?.disconnect()
        channel = null
      }
    })
  }

  const liveQueries = new Set<{
    query: string
    params: QueryParams
    $fetch: MapStore<QueryStoreState<any, any>>
  }>()
  const addLiveQuery = (
    query: string,
    params: QueryParams,
    $fetch: MapStore<QueryStoreState<any, any>>,
  ) => {
    const liveQuery = { query, params, $fetch }
    liveQueries.add(liveQuery)
    emitQueryListen()
    return () => {
      liveQueries.delete(liveQuery)
      emitQueryListen()
    }
  }
  const emitQueryListen = () => {
    if (!channel) {
      throw new Error('No channel')
    }
    const perspective = $perspective.get()
    for (const { query, params, $fetch } of liveQueries) {
      channel.send('loader/query-listen', {
        projectId: projectId!,
        dataset: dataset!,
        perspective,
        query,
        params,
      })
      $fetch.setKey('loading', true)
    }
  }
  function updateLiveQueries() {
    const perspective = $perspective.get()
    const documentsOnPage: ContentSourceMapDocuments = []
    // Loop over liveQueries and apply cache
    for (const { query, params, $fetch } of liveQueries) {
      const key = JSON.stringify({ perspective, query, params })
      const value = cache.get(key)
      if (value) {
        $fetch.setKey('data', value.result)
        $fetch.setKey('sourceMap', value.resultSourceMap)
        $fetch.setKey('loading', false)
        documentsOnPage.push(...(value.resultSourceMap?.documents ?? []))
      }
    }
    channel?.send('loader/documents', {
      projectId: projectId!,
      dataset: dataset!,
      perspective,
      documents: documentsOnPage,
    })
  }

  const runLiveFetch = async <Response, Error>(
    query: string,
    params: QueryParams,
    $fetch: MapStore<QueryStoreState<Response, Error>>,
    controller: AbortController,
  ) => {
    try {
      const removeLiveQuery = addLiveQuery(query, params, $fetch)
      controller.signal.addEventListener(
        'abort',
        () => {
          removeLiveQuery()
          updateLiveQueries()
        },
        {
          once: true,
        },
      )
      updateLiveQueries()
      $fetch.setKey('error', undefined)
      if (controller.signal.aborted) return
    } catch (error: unknown) {
      $fetch.setKey('error', error as Error)
      $fetch.setKey('loading', false)
    }
  }

  return { $LiveMode, runLiveFetch }
}
