'use server';

/**
 * @fileOverview An AI agent that analyzes user's health input and provides potential conditions and suggested tests.
 *
 * - analyzeHealthInput - A function that handles the health input analysis process.
 * - AnalyzeHealthInputInput - The input type for the analyzeHealthInput function.
 * - AnalyzeHealthInputOutput - The return type for the analyzeHealthInput function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const AnalyzeHealthInputInputSchema = z.object({
  healthInput: z.string().describe('The user input describing health symptoms or conditions.'),
  photoDataUri: z
    .string()
    .optional()
    .describe(
      "A photo related to the health input, as a data URI that must include a MIME type and use Base64 encoding. Expected format: 'data:<mimetype>;base64,<encoded_data>'."
    ),
});
export type AnalyzeHealthInputInput = z.infer<typeof AnalyzeHealthInputInputSchema>;

const AnalyzeHealthInputOutputSchema = z.object({
  summary: z.string().describe('A summary of potential conditions based on the input.'),
  suggestedTests: z.string().describe('Suggested tests to further investigate the potential conditions.'),
});
export type AnalyzeHealthInputOutput = z.infer<typeof AnalyzeHealthInputOutputSchema>;

export async function analyzeHealthInput(input: AnalyzeHealthInputInput): Promise<AnalyzeHealthInputOutput> {
  return analyzeHealthInputFlow(input);
}

const prompt = ai.definePrompt({
  name: 'analyzeHealthInputPrompt',
  input: {schema: AnalyzeHealthInputInputSchema},
  output: {schema: AnalyzeHealthInputOutputSchema},
  prompt: `You are a helpful AI assistant providing information related to health symptoms and conditions.

You will analyze the user's input, including any provided images, and provide a summary of potential conditions and suggest tests to further investigate these conditions.

Input: {{{healthInput}}}
{{#if photoDataUri}}
Photo: {{media url=photoDataUri}}
{{/if}}

Summary of potential conditions:
{{summary}}

Suggested tests:
{{suggestedTests}}`,
});

const analyzeHealthInputFlow = ai.defineFlow(
  {
    name: 'analyzeHealthInputFlow',
    inputSchema: AnalyzeHealthInputInputSchema,
    outputSchema: AnalyzeHealthInputOutputSchema,
  },
  async input => {
    const {output} = await prompt(input);
    return output!;
  }
);
