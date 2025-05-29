
'use server';
/**
 * @fileOverview A Genkit flow for direct, streaming chat with an AI model.
 *
 * - streamedChat - A function that handles a user's chat prompt and streams the AI's response.
 * - StreamedChatInput - The input type for the streamedChat function.
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';
import type { Part, GenerateResponse, ContentChunk } from '@genkit-ai/googleai'; // ContentChunk might be from core genkit

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

interface ExpectedGenerateStreamResponse {
  stream: AsyncIterable<ContentChunk>;
  response: Promise<GenerateResponse>;
}

// This server action will return an AsyncIterable for the client to consume.
export async function* streamedChat(input: StreamedChatInput): AsyncGenerator<string, void, undefined> {
  const currentInput = input as StreamedChatInput; // Minor type assertion, unlikely to be the issue but harmless
  const { prompt: textPrompt, photoDataUri } = currentInput;
  const parts: Part[] = [];

  // Add text part if provided
  if (textPrompt && textPrompt.trim() !== "") {
    parts.push({ text: textPrompt });
  }

  // Add image part if provided
  if (photoDataUri) {
    // If there was no text prompt but there is an image, add a default text part for the image.
    // Gemini generally expects text before an image if both are present in a multi-part prompt.
    if (parts.length === 0) {
        parts.push({ text: "ماذا ترى في هذه الصورة؟ صفها بالتفصيل." });
    }
    parts.push({ media: { url: photoDataUri } });
  }
  
  // If after all checks, parts is still empty, it means neither prompt nor image was provided.
  if (parts.length === 0) {
    yield "الرجاء إدخال رسالة أو إرفاق صورة.";
    return;
  }

  // Determine the final prompt structure for Genkit
  // If it's just a single text part, send the string directly. Otherwise, send the array of parts.
  const finalPromptForGenkit = parts.length === 1 && parts[0].text && !parts[0].media && parts.every(p => p.text && !p.media)
    ? parts[0].text
    : parts;

  // Double check finalPromptForGenkit is not empty or an empty array (should be caught by parts.length === 0)
  if (!finalPromptForGenkit || (Array.isArray(finalPromptForGenkit) && finalPromptForGenkit.length === 0)) {
    yield "الرجاء تقديم مدخل صالح.";
    return;
  }
  
  let streamGenResponse: ExpectedGenerateStreamResponse | undefined;
  try {
    streamGenResponse = ai.generateStream({
      prompt: finalPromptForGenkit,
      // model: 'gemini-1.5-flash-latest', // Default is gemini-2.0-flash from genkit.ts
      // config: { temperature: 0.7 } // Optional config
    }) as ExpectedGenerateStreamResponse; // Explicit type assertion

    // Robust check for the structure returned by ai.generateStream
    if (
      !streamGenResponse ||
      typeof streamGenResponse.stream !== 'object' ||
      streamGenResponse.stream === null ||
      typeof streamGenResponse.stream[Symbol.asyncIterator] !== 'function' ||
      !streamGenResponse.response ||
      typeof streamGenResponse.response.then !== 'function' // Check if response is a Promise
    ) {
      console.error("AI stream generation did not return a valid stream and response object:", streamGenResponse);
      yield `عذرًا، حدث خطأ في تهيئة بث الرد من الذكاء الاصطناعي. يرجى المحاولة مرة أخرى.`;
      return;
    }

    const { stream, response: fullResponsePromise } = streamGenResponse;

    for await (const chunk of stream) {
      if (chunk.text) { 
        yield chunk.text;
      }
    }
    await fullResponsePromise; 
  } catch (error) {
    console.error("Error during AI stream generation or processing:", error);
    const errorMessage = error instanceof Error ? error.message : "An error occurred";
    // Ensure we always yield, even in case of error, to maintain async generator contract
    yield `عذرًا، حدث خطأ أثناء إنشاء الرد: ${errorMessage}`;
  }
}

