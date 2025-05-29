
import { config } from 'dotenv';
config();

import '@/ai/flows/analyze-health-input.ts';
import '@/ai/flows/summarize-medical-report.ts';
import '@/ai/flows/image-analysis.ts';
import '@/ai/flows/streamed-chat-flow.ts'; // Added new streaming chat flow
