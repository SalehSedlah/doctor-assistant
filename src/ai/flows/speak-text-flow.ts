
'use server';
/**
 * @fileOverview A Genkit flow for converting text to speech using Google Cloud Text-to-Speech API.
 *
 * - speakText - A function that takes text and returns base64 encoded audio.
 * - SpeakTextInput - The input type for the speakText function.
 * - SpeakTextOutput - The output type for the speakText function.
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';
import { TextToSpeechClient, protos } from '@google-cloud/text-to-speech';

// This client relies on GOOGLE_APPLICATION_CREDENTIALS env var or default creds in Cloud environment.
const ttsClient = new TextToSpeechClient();

const SpeakTextInputSchema = z.object({
  text: z.string().describe('The text to be converted to speech.'),
  languageCode: z.string().optional().default('ar-XA').describe('The language code (e.g., "en-US", "ar-XA"). Defaults to Arabic (XA region).'),
  voiceName: z.string().optional().default('ar-XA-Wavenet-D').describe('The voice name (e.g., "en-US-Wavenet-D", "ar-XA-Wavenet-D"). Defaults to an Arabic Wavenet voice.'),
});
export type SpeakTextInput = z.infer<typeof SpeakTextInputSchema>;

const SpeakTextOutputSchema = z.object({
  audioContent: z.string().describe("Base64 encoded audio content of the spoken text (MP3 format)."),
});
export type SpeakTextOutput = z.infer<typeof SpeakTextOutputSchema>;

export async function speakText(input: SpeakTextInput): Promise<SpeakTextOutput> {
  return speakTextFlow(input);
}

const speakTextFlow = ai.defineFlow(
  {
    name: 'speakTextFlow',
    inputSchema: SpeakTextInputSchema,
    outputSchema: SpeakTextOutputSchema,
  },
  async (input) => {
    try {
      const request: protos.google.cloud.texttospeech.v1.ISynthesizeSpeechRequest = {
        input: { text: input.text },
        voice: { languageCode: input.languageCode!, name: input.voiceName! },
        audioConfig: { audioEncoding: 'MP3' },
      };

      const [response] = await ttsClient.synthesizeSpeech(request);
      
      if (!response.audioContent) {
        throw new Error('No audio content received from Text-to-Speech API.');
      }

      let audioBase64: string;
      if (response.audioContent instanceof Uint8Array) {
        audioBase64 = Buffer.from(response.audioContent).toString('base64');
      } else if (typeof response.audioContent === 'string') {
        // Already base64, though API usually returns Uint8Array/Buffer
        audioBase64 = response.audioContent;
      } else {
         throw new Error('Unexpected audio content type from Text-to-Speech API.');
      }
      
      return { audioContent: audioBase64 };
    } catch (error) {
      console.error('Error in speakTextFlow:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      // It's better to throw the error so the client can handle it,
      // or return a structured error response if preferred.
      // For Genkit, throwing will result in a flow error.
      throw new Error(`Failed to synthesize speech: ${errorMessage}`);
    }
  }
);

