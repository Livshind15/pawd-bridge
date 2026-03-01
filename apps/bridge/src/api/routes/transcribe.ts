import { FastifyInstance } from 'fastify';
import { logger } from '../../utils/logger.js';

export function transcribeRoutes(fastify: FastifyInstance): void {
  /**
   * POST /api/transcribe
   * Accepts multipart audio file, sends to OpenAI Whisper API, returns text.
   */
  fastify.post('/api/transcribe', async (request, reply) => {
    const openaiKey = process.env.OPENAI_API_KEY || '';
    if (!openaiKey) {
      return reply.status(500).send({
        error: { message: 'OpenAI API key not configured. Set OPENAI_API_KEY in your .env file.' },
      });
    }

    const data = await request.file();
    if (!data) {
      return reply.status(400).send({
        error: { message: 'No audio file provided. Send multipart form with "file" field.' },
      });
    }

    logger.info(
      { filename: data.filename, mimetype: data.mimetype },
      '[transcribe] Received audio file'
    );

    try {
      // Read the file buffer from the stream
      const chunks: Buffer[] = [];
      for await (const chunk of data.file) {
        chunks.push(chunk);
      }
      const audioBuffer = Buffer.concat(chunks);

      // Build multipart form for OpenAI Whisper API
      const boundary = `----FormBoundary${Date.now()}`;
      const filename = data.filename || 'audio.m4a';

      const preamble = [
        `--${boundary}`,
        `Content-Disposition: form-data; name="file"; filename="${filename}"`,
        `Content-Type: ${data.mimetype || 'audio/m4a'}`,
        '',
        '',
      ].join('\r\n');

      const modelField = [
        '',
        `--${boundary}`,
        'Content-Disposition: form-data; name="model"',
        '',
        'whisper-1',
        `--${boundary}--`,
        '',
      ].join('\r\n');

      const body = Buffer.concat([
        Buffer.from(preamble, 'utf-8'),
        audioBuffer,
        Buffer.from(modelField, 'utf-8'),
      ]);

      const whisperRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${openaiKey}`,
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
        },
        body,
      });

      if (!whisperRes.ok) {
        const errBody = await whisperRes.text();
        logger.error({ status: whisperRes.status, body: errBody }, '[transcribe] Whisper API error');
        return reply.status(502).send({
          error: { message: `Whisper API error: ${whisperRes.status}` },
        });
      }

      const result = (await whisperRes.json()) as { text?: string };
      const text = result.text?.trim() || '';

      logger.info({ textLength: text.length }, '[transcribe] Transcription complete');
      return { text };
    } catch (err) {
      logger.error({ err }, '[transcribe] Failed to transcribe audio');
      return reply.status(500).send({
        error: { message: 'Transcription failed' },
      });
    }
  });
}
