// 'use server';
/**
 * @fileOverview Summarizes a medical report to extract key findings.
 *
 * - summarizeMedicalReport - A function that handles the summarization process.
 * - SummarizeMedicalReportInput - The input type for the summarizeMedicalReport function.
 * - SummarizeMedicalReportOutput - The return type for the summarizeMedicalReport function.
 */

'use server';

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const SummarizeMedicalReportInputSchema = z.object({
  reportDataUri: z
    .string()
    .describe(
      "A medical report, as a data URI that must include a MIME type and use Base64 encoding. Expected format: 'data:<mimetype>;base64,<encoded_data>'."
    ),
});
export type SummarizeMedicalReportInput = z.infer<typeof SummarizeMedicalReportInputSchema>;

const SummarizeMedicalReportOutputSchema = z.object({
  summary: z.string().describe('A summary of the key findings in the medical report.'),
});
export type SummarizeMedicalReportOutput = z.infer<typeof SummarizeMedicalReportOutputSchema>;

export async function summarizeMedicalReport(input: SummarizeMedicalReportInput): Promise<SummarizeMedicalReportOutput> {
  return summarizeMedicalReportFlow(input);
}

const prompt = ai.definePrompt({
  name: 'summarizeMedicalReportPrompt',
  input: {schema: SummarizeMedicalReportInputSchema},
  output: {schema: SummarizeMedicalReportOutputSchema},
  prompt: `You are an expert medical summarizer.

You will be given a medical report and you will summarize the key findings in the report.

Medical Report: {{media url=reportDataUri}}`,
});

const summarizeMedicalReportFlow = ai.defineFlow(
  {
    name: 'summarizeMedicalReportFlow',
    inputSchema: SummarizeMedicalReportInputSchema,
    outputSchema: SummarizeMedicalReportOutputSchema,
  },
  async input => {
    const {output} = await prompt(input);
    return output!;
  }
);
