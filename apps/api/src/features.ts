import { ArtifactsController } from './modules/artifacts/artifacts.controller';
import { DiscoveryController } from './modules/discovery/discovery.controller';
import { InsightsController } from './modules/insights/insights.controller';
import { LibraryController } from './modules/library/library.controller';
import { MetadataService } from './modules/library/metadata.service';
import { NotesController } from './modules/notes/notes.controller';
import { SearchController } from './modules/search/search.controller';
import { StudioController } from './modules/studio/studio.controller';
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
  LibraryController,
  DiscoveryController,
  StudioController,
];
export const FEATURE_PROVIDERS: any[] = [MetadataService];
