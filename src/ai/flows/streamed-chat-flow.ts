
'use server';
/**
 * @fileOverview A Genkit flow for direct, streaming chat with an AI model.
 *
 * - streamedChat - A function that handles a user's chat prompt and streams the AI's response.
 * - StreamedChatInput - The input type for the streamedChat function.
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';
import type { Part } from '@genkit-ai/googleai';

const StreamedChatInputSchema = z.object({
  prompt: z.string().describe('The user message to the AI.'),
  photoDataUri: z
    .string()
    .optional()
    .describe(
      "An optional photo related to the prompt, as a data URI. Expected format: 'data:<mimetype>;base64,<encoded_data>'."
    ),
});
export type StreamedChatInput = z.infer<typeof StreamedChatInputSchema>;

// This server action will return an AsyncIterable for the client to consume.
export async function* streamedChat(input: StreamedChatInput): AsyncGenerator<string, void, undefined> {
  const promptParts: Part[] = [];

  if (input.prompt) {
    promptParts.push({ text: input.prompt });
  } else if (input.photoDataUri) {
    // If only an image is provided, add a default text prompt.
    promptParts.push({ text: "ماذا ترى في هذه الصورة؟ صفها بالتفصيل." });
  }

  if (input.photoDataUri) {
    // The Gemini API expects multi-part prompts (text & image) to have the image data after the text.
    // If prompt was empty and only image was provided, the default text part is already added.
    // If prompt was provided, it's already added. Now add the image.
    promptParts.push({ media: { url: input.photoDataUri } });
  }
  
  // If after all, promptParts is empty (e.g., empty input string and no image), yield an error message.
  if (promptParts.length === 0) {
    yield "الرجاء إدخال رسالة أو إرفاق صورة.";
    return;
  }

  // Ensure there's at least one text part if sending multiple parts,
  // and that it's usually first. The logic above should handle this.
  // If only one part and it's text, send as string. Otherwise, as Part[].
  const finalPrompt = promptParts.length === 1 && promptParts[0].text && !promptParts[0].media
    ? promptParts[0].text
    : promptParts;

  if (!finalPrompt || (Array.isArray(finalPrompt) && finalPrompt.length === 0)) {
    yield "الرجاء تقديم مدخل صالح.";
    return;
  }
  
  const { stream, response: fullResponsePromise } = ai.generateStream({
    prompt: finalPrompt,
    // model: 'gemini-1.5-flash-latest', // Default is gemini-2.0-flash from genkit.ts
    // config: { temperature: 0.7 } // Optional config
  });

  try {
    for await (const chunk of stream) {
      if (chunk.text) { // Ensure text exists in the chunk
        yield chunk.text;
      }
    }
    await fullResponsePromise; // Wait for the full response to settle
  } catch (error) {
    console.error("Error during AI stream generation:", error);
    // Try to yield a more specific error if possible
    const errorMessage = error instanceof Error ? error.message : "An error occurred";
    yield `عذرًا، حدث خطأ أثناء إنشاء الرد: ${errorMessage}`;
  }
}
