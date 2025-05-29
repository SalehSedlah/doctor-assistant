import { config } from 'dotenv';
config();

import '@/ai/flows/analyze-health-input.ts';
import '@/ai/flows/summarize-medical-report.ts';
import '@/ai/flows/image-analysis.ts';