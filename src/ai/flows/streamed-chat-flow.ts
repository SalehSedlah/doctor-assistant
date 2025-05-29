
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
  const currentInput = input as StreamedChatInput; // Minor explicit type assertion

  if (currentInput.prompt) {
    promptParts.push({ text: currentInput.prompt });
  } else if (currentInput.photoDataUri) {
    // If only an image is provided, add a default text prompt.
    promptParts.push({ text: "ماذا ترى في هذه الصورة؟ صفها بالتفصيل." });
  }

  if (currentInput.photoDataUri) {
    // The Gemini API expects multi-part prompts (text & image) to have the image data after the text.
    promptParts.push({ media: { url: currentInput.photoDataUri } });
  }
  
  if (promptParts.length === 0) {
    yield "الرجاء إدخال رسالة أو إرفاق صورة.";
    return;
  }

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
      if (chunk.text) { 
        yield chunk.text;
      }
    }
    await fullResponsePromise; 
  } catch (error) {
    console.error("Error during AI stream generation:", error);
    const errorMessage = error instanceof Error ? error.message : "An error occurred";
    yield `عذرًا، حدث خطأ أثناء إنشاء الرد: ${errorMessage}`;
  }
}

