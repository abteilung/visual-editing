import type { QueryParams } from 'next-sanity'
import { draftMode } from 'next/headers'
import dynamic from 'next/dynamic'
import 'server-only'
import { client } from './client'
import { revalidateSecret, token } from './env'
import { UnfilteredResponseQueryOptions } from '@sanity/client/stega'

const DEFAULT_PARAMS = {} as QueryParams
const DEFAULT_TAGS = [] as string[]

const RevalidateQuery = dynamic(
  () => import('@/components/VisualEditing/RevalidateQuery'),
)

export async function loadQuery<QueryResponse>({
  query,
  params = DEFAULT_PARAMS,
  tags: _tags = DEFAULT_TAGS,
}: {
  query: string
  params?: QueryParams
  tags: string[]
}): Promise<[QueryResponse, () => JSX.Element | null]> {
  const isDraftMode = draftMode().isEnabled
  if (isDraftMode && !token) {
    throw new Error(
      'The `SANITY_API_READ_TOKEN` environment variable is required in Draft Mode.',
    )
  }

  // https://nextjs.org/docs/app/api-reference/functions/fetch#optionsnextrevalidate
  /*
  const REVALIDATE_SKIP_CACHE = 0
  const REVALIDATE_CACHE_FOREVER = false
  const revalidate = (
    isDraftMode
      ? // If we're in Draft Mode we want fresh content on every request so we skip the cache
        REVALIDATE_SKIP_CACHE
      : revalidateSecret
        ? // If GROQ webhook revalidation is setup, then we only want to revalidate on-demand so the cache lives as long as possible
          REVALIDATE_CACHE_FOREVER
        : // No webhook means we don't know ahead of time when content changes, so we use the Sanity CDN API cache which has its own Stale-While-Revalidate logic
          REVALIDATE_SKIP_CACHE
          ) satisfies NextFetchRequestConfig['revalidate']
          // */

  const { projectId, dataset } = client.config()
  const perspective = isDraftMode ? 'previewDrafts' : 'published'
  const tags = isDraftMode ? _tags.map((tag) => `${perspective}:${tag}`) : _tags

  const options = {
    filterResponse: false,
    resultSourceMap: isDraftMode ? 'withKeyArraySelector' : false,
    useCdn: !isDraftMode,
    token: isDraftMode ? token : undefined,
    perspective,
    next: isDraftMode ? { tags } : { revalidate: 60 },
  } satisfies UnfilteredResponseQueryOptions
  const result = await client.fetch<QueryResponse>(query, params, {
    ...options,
    stega: isDraftMode,
  } as UnfilteredResponseQueryOptions)
  return [
    result.result,
    function PreviewQuery() {
      if (!draftMode().isEnabled) {
        return null
      }
      return (
        <RevalidateQuery
          projectId={projectId!}
          dataset={dataset!}
          perspective={perspective}
          query={query}
          params={params}
          data={result.result}
          sourceMap={result.resultSourceMap!}
          tags={tags}
        />
      )
    },
  ]
}
