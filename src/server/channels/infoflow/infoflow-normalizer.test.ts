import { describe, expect, it } from 'vitest'

import { normalizeInfoFlowEvent } from './infoflow-normalizer'

const context = {
  agentId: 'agent-1',
  agentChannelId: 'channel-1',
  connectionId: 'connection-1',
  externalAgentId: '50655',
}

describe('normalizeInfoFlowEvent', () => {
  it('normalizes a private text message', () => {
    const event = normalizeInfoFlowEvent(
      {
        type: 'private.text',
        timestamp: 1,
        data: {
          chatType: 'private',
          msgType: 'text',
          raw: {
            MsgId: 'private-msg-1',
            FromUserId: 'alice',
            Content: '你好',
            CreateTime: '1792400000000',
          },
        },
      },
      context,
    )

    expect(event).toEqual(
      expect.objectContaining({
        externalEventId: 'private-msg-1',
        senderExternalId: 'alice',
        chatType: 'private',
        replyTargetType: 'user',
        replyTargetId: 'alice',
        contentText: '你好',
        scopeKey: 'infoflow:private:alice',
      }),
    )
  })

  it('normalizes a private image message without colliding with its text event', () => {
    const event = normalizeInfoFlowEvent(
      {
        type: 'private.image',
        timestamp: 1,
        data: {
          chatType: 'private',
          msgType: 'image',
          raw: {
            MsgId: 'private-image-1',
            FromUserId: 'alice',
            MsgType: 'image',
            t: 'png',
            ImgDownloadurl: 'https://api.im.baidu.com/image/private-image-1',
            CreateTime: '1792400000000',
          },
        },
      },
      context,
    )

    expect(event).toEqual(
      expect.objectContaining({
        externalEventId: 'private-image-1:image',
        senderExternalId: 'alice',
        chatType: 'private',
        contentText: '请分析这张图片。',
        images: [
          {
            sourceUrl: 'https://api.im.baidu.com/image/private-image-1',
            mimeType: 'image/png',
          },
        ],
      }),
    )
  })

  it('normalizes an image block in a mentioned group message', () => {
    const event = normalizeInfoFlowEvent(
      {
        type: 'group.image',
        timestamp: 1,
        data: {
          chatType: 'group',
          msgType: 'image',
          raw: {
            eventtype: 'MESSAGE_RECEIVE',
            groupid: 123,
            message: {
              header: {
                fromuserid: 'alice',
                messageid: 'group-image-1',
              },
              body: [
                { type: 'AT', robotid: 50655 },
                {
                  type: 'IMAGE',
                  downloadurl: 'https://api.im.baidu.com/image/group-image-1',
                },
                { type: 'TEXT', content: '分析一下' },
              ],
            },
          },
        },
      },
      context,
    )

    expect(event).toEqual(
      expect.objectContaining({
        contentText: '分析一下',
        images: [
          {
            sourceUrl: 'https://api.im.baidu.com/image/group-image-1',
          },
        ],
      }),
    )
  })

  it('ignores group messages without mentioning the current bot', () => {
    const event = normalizeInfoFlowEvent(
      {
        type: 'group.text',
        timestamp: 1,
        data: {
          chatType: 'group',
          msgType: 'text',
          raw: {
            eventtype: 'MESSAGE_RECEIVE',
            groupid: 123,
            message: {
              header: {
                fromuserid: 'alice',
                messageid: 'group-msg-1',
              },
              body: [{ type: 'TEXT', content: '普通群消息' }],
            },
          },
        },
      },
      context,
    )

    expect(event).toBeNull()
  })

  it('accepts a group message mentioning the current bot', () => {
    const event = normalizeInfoFlowEvent(
      {
        type: 'group.mixed',
        timestamp: 1,
        data: {
          chatType: 'group',
          msgType: 'mixed',
          raw: {
            eventtype: 'MESSAGE_RECEIVE',
            groupid: 123,
            message: {
              header: {
                fromuserid: 'alice',
                messageid: 'group-msg-2',
              },
              body: [
                { type: 'AT', robotid: 50655 },
                { type: 'TEXT', content: '请评审' },
              ],
            },
          },
        },
      },
      context,
    )

    expect(event).toEqual(
      expect.objectContaining({
        chatType: 'group',
        senderExternalId: 'alice',
        replyTargetType: 'group',
        replyTargetId: '123',
        contentText: '请评审',
        scopeKey: 'infoflow:group:123:sender:alice',
      }),
    )
  })

  it('ignores another bot mention and self-authored messages', () => {
    const otherBot = {
      type: 'group.mixed',
      timestamp: 1,
      data: {
        chatType: 'group',
        msgType: 'mixed',
        raw: {
          eventtype: 'MESSAGE_RECEIVE',
          groupid: 123,
          message: {
            header: { fromuserid: 'alice', messageid: 'm1' },
            body: [
              { type: 'AT', robotid: 99999 },
              { type: 'TEXT', content: 'hello' },
            ],
          },
        },
      },
    }
    expect(normalizeInfoFlowEvent(otherBot, context)).toBeNull()

    const self = {
      ...otherBot,
      data: {
        ...otherBot.data,
        raw: {
          ...otherBot.data.raw,
          message: {
            header: { fromuserid: 'bot#50655', messageid: 'm2' },
            body: [{ type: 'TEXT', content: 'self' }],
          },
        },
      },
    }
    expect(normalizeInfoFlowEvent(self, context)).toBeNull()
  })
})
