import {
  ChannelEventHandler,
  ChannelMsg,
  ChannelReturns,
  createChannel,
} from 'channels'
import { startTransition, useEffect, useRef, useState } from 'react'

export function useChannel<T extends ChannelMsg>(
  handler: ChannelEventHandler<T>,
  targetOrigin: string,
): [channel: ChannelReturns<T> | undefined, connected: boolean] {
  const channelRef = useRef<ChannelReturns<T>>()
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    const channel = createChannel<T>({
      id: 'overlays',
      onConnect: () => startTransition(() => setConnected(true)),
      onDisconnect: () => startTransition(() => setConnected(false)),
      connections: [
        {
          target: parent,
          targetOrigin,
          id: 'composer',
        },
      ],
      handler,
    })
    channelRef.current = channel
    return () => {
      channel.disconnect()
      channelRef.current = undefined
      setConnected(false)
    }
  }, [handler, targetOrigin])

  return [channelRef.current, connected]
}
