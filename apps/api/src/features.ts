import { ArtifactsController } from './modules/artifacts/artifacts.controller';
import { InsightsController } from './modules/insights/insights.controller';
import { NotesController } from './modules/notes/notes.controller';
import { SearchController } from './modules/search/search.controller';
import { DnaController } from './modules/writer/dna.controller';
import { ManuscriptsController } from './modules/writer/manuscripts.controller';
import { ResearchController } from './modules/writer/research.controller';
import { SuggestionsController } from './modules/writer/suggestions.controller';

// Module controllers added gate by gate (Knowledge, Writer, Library, Discovery, Studio, Cost admin).
export const FEATURE_CONTROLLERS: any[] = [
  InsightsController,
  ArtifactsController,
  NotesController,
  SearchController,
  ManuscriptsController,
  SuggestionsController,
  DnaController,
  ResearchController,
];
export const FEATURE_PROVIDERS: any[] = [];
