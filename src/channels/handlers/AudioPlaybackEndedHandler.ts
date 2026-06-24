import { injectable } from 'tsyringe';
import type { ClientMessageHandler } from '../ClientMessageHandler';
import type { ClientMessageHandlerContext } from '../ClientMessageHandlerContext';
import { calAudioPlaybackEndedRequestSchema } from '../messages';
import type { CALAudioPlaybackEndedRequest } from '../messages';
import { logger } from '../../utils/logger';
import { ChannelMessageHandler } from '../ClientMessageHandlerRegistry';

@ChannelMessageHandler('audio_playback_ended', true, calAudioPlaybackEndedRequestSchema)
@injectable()
export class AudioPlaybackEndedHandler implements ClientMessageHandler<CALAudioPlaybackEndedRequest> {
  readonly messageType!: string;
  readonly requiresAuth!: boolean;

  async handle(context: ClientMessageHandlerContext, message: CALAudioPlaybackEndedRequest): Promise<void> {
    logger.debug({ sessionId: context.session?.id, conversationId: message.conversationId }, 'Audio playback ended notification received');
    if (!context.session?.runner) return;
    context.session.runner.notifyAudioPlaybackEnded();
  }
}
