import { ArtifactsController } from './modules/artifacts/artifacts.controller';
import { InsightsController } from './modules/insights/insights.controller';
import { NotesController } from './modules/notes/notes.controller';
import { SearchController } from './modules/search/search.controller';

// Module controllers added gate by gate (Knowledge, Writer, Library, Discovery, Studio, Cost admin).
export const FEATURE_CONTROLLERS: any[] = [InsightsController, ArtifactsController, NotesController, SearchController];
export const FEATURE_PROVIDERS: any[] = [];
