import { useRef, useState } from 'react';
import { tokens } from '@folioverse/design-tokens';
import { STATES } from '@/shared/states.js';
import { Icon, ICON_NAMES } from '@/shared/icons.jsx';
import { SHORTCUTS } from '@/shared/a11y/shortcuts.js';
import { useUiStore } from '@/stores/ui.js';
import {
  Badge,
  Button,
  Callout,
  Card,
  DemoBadge,
  Dialog,
  DropdownMenu,
  Field,
  IconButton,
  Input,
  KeyValue,
  Popover,
  Progress,
  SectionHeading,
  Segmented,
  Select,
  Sheet,
  Skeleton,
  StageTrack,
  StatusBadge,
  Table,
  Tabs,
  Textarea,
  Tooltip,
  toast,
} from '@/shared/ui/index.js';
import { EvidenceDrawer } from '@/shared/overlays/EvidenceDrawer.jsx';
import { FolioLens } from '@/shared/overlays/FolioLens.jsx';
import { ModelSelector } from '@/shared/overlays/ModelSelector.jsx';
import { RunReceipt } from '@/shared/overlays/RunReceipt.jsx';
import { Page, PageHeader } from '@/shared/layout/Panes.jsx';

const FAMILY_TITLES = {
  ingest: 'Ingestion',
  run: 'Run status',
  outcome: 'Run outcome',
  cite: 'Citation',
  anchor: 'Anchor',
  sugg: 'Suggestion',
  cost: 'Cost tier',
  dna: 'Narrative DNA',
  origin: 'Fact origin',
};

/** DEMO fixtures for the gallery only. */
const DEMO_CITATION = {
  marker: 'S1',
  state: 'VALID',
  anchorState: 'SHIFTED',
  title: 'Market Outlook 2026.pdf (DEMO)',
  versionNumber: 2,
  currentVersionNumber: 3,
  locator: 'p. 12 · §2.1 Base scenario',
  quote: 'the addressable market for assisted research tools grows at a compound annual rate of 14.2% between 2026 and 2030',
  claim: 'The base scenario projects 14.2% annual growth.',
};
const DEMO_RECEIPT = {
  run: { id: 'run_demo_0001', graph: 'grounded_qa', tier: 'T1', status: 'SUCCEEDED', outcome: 'ANSWERED', isDemo: true, durationMs: 4800 },
  modelPlan: { primary: { provider: 'mock', model: 'mock-grounded' } },
  modelCalls: [{ provider: 'mock', model: 'mock-grounded', attempt: 1, status: 'SUCCEEDED' }],
  tokens: { input: 6214, cachedInput: 1536, output: 512, reasoning: 0 },
  cost: { total: '0.00910000', estimate: '0.01200000', tier: 'FINALIZED', currency: 'USD', isDemo: true },
  citations: { total: 4, byState: { VALID: 2, WEAK: 1, UNRESOLVED: 1 } },
  traceUrl: '/app/studio/runs/run_demo_0001',
};
const DEMO_MODELS = [
  { id: 'mock-grounded', label: 'mock-grounded', provider: 'mock', isDemo: true, priced: true },
  { id: 'local-compute', label: 'cpu-embedding', provider: 'local', priced: false },
];

function Section({ id, title, children }) {
  return (
    <section aria-labelledby={id} style={{ marginBottom: 32 }}>
      <SectionHeading id={id}>{title}</SectionHeading>
      {children}
    </section>
  );
}

export function DesignGalleryPage() {
  const setPaletteOpen = useUiStore((s) => s.setPaletteOpen);
  const [dialog, setDialog] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [evidence, setEvidence] = useState(false);
  const [lens, setLens] = useState(null);
  const [lensResult, setLensResult] = useState(null);
  const [seg, setSeg] = useState('serif');
  const [model, setModel] = useState('auto');
  const lensBtn = useRef(null);

  const openLens = (kind) => {
    if (!lensBtn.current) return;
    const r = lensBtn.current.getBoundingClientRect();
    setLensResult(null);
    setLens({ kind, anchor: { left: r.left, top: r.top, bottom: r.bottom, width: r.width } });
  };

  return (
    <Page>
      <PageHeader
        eyebrow="Documentation · Design system"
        title="Component gallery"
        lede="Tokens, state vocabularies, primitives and shared overlays as implemented in the web app. Examples use DEMO data."
        actions={<DemoBadge />}
      />

      <Section id="g-colors" title="Colour tokens">
        <div className="gallery-grid">
          {Object.keys(tokens.color.light).map((k) => (
            <div key={k} className="swatch">
              <i style={{ background: `var(--fv-${k})` }} />
              --fv-{k}
            </div>
          ))}
        </div>
      </Section>

      <Section id="g-type" title="Typography">
        <div className="stack" style={{ gap: 8 }}>
          {Object.entries(tokens.fs)
            .reverse()
            .map(([k, v]) => (
              <p key={k} style={{ fontSize: `var(--fv-fs-${k})` }}>
                <span className="mono subtle">fs-{k} · {v}</span> The archive smelled of salt and old varnish.
              </p>
            ))}
          <p style={{ fontFamily: 'var(--fv-font-serif)', fontSize: 18 }}>Serif — reading and manuscript text.</p>
          <p className="mono">Mono — identifiers, tokens and amounts.</p>
        </div>
      </Section>

      <Section id="g-states" title="State vocabularies">
        <div className="stack" style={{ gap: 14 }}>
          {Object.entries(STATES).map(([family, values]) => (
            <div key={family} data-testid={`family-${family}`}>
              <p className="eyebrow" style={{ marginBottom: 6 }}>
                {FAMILY_TITLES[family]}
              </p>
              <div className="row">
                {Object.keys(values).map((v) => (
                  <StatusBadge key={v} family={family} value={v} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section id="g-stages" title="Ingestion stage track">
        <div className="gallery-grid">
          {Object.keys(STATES.ingest).map((s) => (
            <div key={s}>
              <StatusBadge family="ingest" value={s} />
              <StageTrack state={s} labels />
            </div>
          ))}
        </div>
      </Section>

      <Section id="g-cites" title="Citation chips">
        <p>
          Example claim with markers{' '}
          {Object.entries(STATES.cite).map(([k, [tone, glyph, label]], i) => (
            <button key={k} type="button" className="cite" data-tone={tone} aria-label={`Citation S${i + 1}: ${label}`}>
              S{i + 1}
              <span aria-hidden="true">{glyph}</span>
            </button>
          ))}
        </p>
      </Section>

      <Section id="g-buttons" title="Buttons">
        <div className="row">
          <Button variant="primary">Primary</Button>
          <Button>Default</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="ai">
            <Icon name="lens" size={14} /> AI action
          </Button>
          <Button variant="danger">Delete</Button>
          <Button size="sm">Small</Button>
          <Button disabled>Disabled</Button>
          <IconButton label="Upload">
            <Icon name="upload" />
          </IconButton>
          <kbd>Ctrl K</kbd>
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          {ICON_NAMES.map((n) => (
            <span key={n} title={n} className="icon-btn">
              <Icon name={n} />
            </span>
          ))}
        </div>
      </Section>

      <Section id="g-fields" title="Fields">
        <div className="form" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <Field label="Project name" hint="Shown in breadcrumbs">
            <Input placeholder="Project Atlas" />
          </Field>
          <Field label="Kind">
            <Select
              options={[
                { value: 'KNOWLEDGE', label: 'Knowledge' },
                { value: 'WRITER', label: 'Writer' },
                { value: 'LIBRARY', label: 'Library' },
              ]}
            />
          </Field>
          <Field label="Notes" error="Notes must be under 2,000 characters.">
            <Textarea rows={3} />
          </Field>
          <div className="stack" style={{ gap: 10 }}>
            <Segmented
              label="Font"
              value={seg}
              onChange={setSeg}
              options={[
                { value: 'serif', label: 'Serif' },
                { value: 'sans', label: 'Sans' },
              ]}
            />
            <ModelSelector options={DEMO_MODELS} value={model} onChange={setModel} />
          </div>
        </div>
      </Section>

      <Section id="g-feedback" title="Feedback">
        <div className="stack" style={{ gap: 10 }}>
          <Progress value={62} label="Indexing progress" />
          <div className="row">
            <Skeleton width={180} />
            <Skeleton width={120} />
          </div>
          <Callout>Neutral callout.</Callout>
          <Callout tone="warn">Pages 31–34 have no text layer.</Callout>
          <Callout tone="bad">Parsing failed. No AI charges were incurred.</Callout>
          <Callout tone="ai">AI-generated content is marked like this.</Callout>
          <div className="row">
            {['info', 'ok', 'warn', 'bad', 'ai'].map((t) => (
              <Button key={t} size="sm" onClick={() => toast(`Example ${t} notification (DEMO)`, t)}>
                Toast · {t}
              </Button>
            ))}
            <Badge tone="info" glyph="i">
              Custom badge
            </Badge>
          </div>
        </div>
      </Section>

      <Section id="g-data" title="Tabs, table and key/value">
        <Tabs
          label="Example tabs"
          tabs={[
            {
              value: 'table',
              label: 'Table',
              content: (
                <Table
                  caption="Example documents (DEMO)"
                  columns={[
                    { key: 'name', label: 'Name' },
                    { key: 'state', label: 'State', render: (r) => <StatusBadge family="ingest" value={r.state} /> },
                    { key: 'pages', label: 'Pages', numeric: true },
                  ]}
                  rows={[
                    { id: 'a', name: 'Market Outlook 2026.pdf', state: 'READY', pages: 48 },
                    { id: 'b', name: 'Risk Assessment.pdf', state: 'PARTIAL', pages: 36 },
                  ]}
                />
              ),
            },
            {
              value: 'kv',
              label: 'Key/value',
              content: <KeyValue items={[['Workspace', 'Aster (DEMO)'], ['Members', '4'], ['Budget', '$10.00 / month']]} />,
            },
          ]}
        />
      </Section>

      <Section id="g-overlays" title="Overlays">
        <div className="row">
          <Button onClick={() => setPaletteOpen(true)}>Command palette</Button>
          <Button onClick={() => setDialog(true)}>Dialog</Button>
          <Button onClick={() => setSheet(true)}>Sheet</Button>
          <Button onClick={() => setEvidence(true)}>Evidence drawer</Button>
          <Button ref={lensBtn} variant="ai" onClick={() => openLens('K')}>
            Folio Lens
          </Button>
          <Tooltip content="Tooltips appear on hover and focus">
            <Button>Tooltip</Button>
          </Tooltip>
          <DropdownMenu
            trigger={<Button>Menu</Button>}
            items={[
              { label: 'Rename', onSelect: () => toast('Rename (DEMO)') },
              { label: 'Move', onSelect: () => toast('Move (DEMO)') },
              '-',
              { label: 'Move to trash', danger: true, onSelect: () => toast('Trash (DEMO)', 'warn') },
            ]}
          />
          <Popover trigger={<Button>Popover</Button>} label="Example popover">
            <p>Popovers hold small forms and details.</p>
          </Popover>
        </div>
        <div style={{ marginTop: 14, maxWidth: 640 }}>
          <RunReceipt receipt={DEMO_RECEIPT} actionLabel="Compare growth projections (DEMO)" />
        </div>
        <Card style={{ marginTop: 14 }}>
          <p className="eyebrow">Lens result states</p>
          <div className="row" style={{ marginTop: 8 }}>
            {[
              ['loading', { phase: 'loading' }],
              ['streaming', { phase: 'streaming', text: 'The passage frames lanterns as debts…' }],
              ['abstain', { phase: 'abstain' }],
              ['error', { phase: 'error', message: 'Provider unavailable before the first token. No charge.', onRetry: () => setLensResult(null) }],
            ].map(([k, r]) => (
              <Button
                key={k}
                size="sm"
                onClick={() => {
                  openLens('R');
                  setLensResult(r);
                }}
              >
                {k}
              </Button>
            ))}
          </div>
        </Card>
      </Section>

      <Section id="g-keys" title="Keyboard shortcuts">
        <KeyValue
          items={SHORTCUTS.map((s) => [
            <span key={s.description} className="row" style={{ gap: 3 }}>
              {s.keys.map((k, i) => (
                <kbd key={`${k}-${i}`}>{k}</kbd>
              ))}
            </span>,
            s.description,
          ])}
        />
      </Section>

      <Dialog
        open={dialog}
        onOpenChange={setDialog}
        title="Create project"
        description="Dialogs trap focus and return it to the trigger on close."
        footer={
          <>
            <Button onClick={() => setDialog(false)}>Cancel</Button>
            <Button variant="primary" onClick={() => setDialog(false)}>
              Create
            </Button>
          </>
        }
      >
        <Field label="Name">
          <Input autoFocus />
        </Field>
      </Dialog>
      <Sheet open={sheet} onOpenChange={setSheet} title="Example sheet">
        <p>Sheets slide in from the right at 440px.</p>
      </Sheet>
      <EvidenceDrawer open={evidence} onOpenChange={setEvidence} citation={DEMO_CITATION} onOpenSource={() => setEvidence(false)} />
      <FolioLens
        open={Boolean(lens)}
        kind={lens?.kind ?? 'K'}
        anchor={lens?.anchor ?? null}
        text="the addressable market for assisted research tools grows at a compound annual rate"
        result={lensResult}
        autoFocus
        onClose={() => setLens(null)}
        onAction={(id) => {
          setLensResult({ phase: 'done', text: `Simulated result for “${id}” (DEMO). No model was called.` });
        }}
        onAsk={(q) => setLensResult({ phase: 'abstain', message: `No evidence found for “${q}” (DEMO).` })}
      />
    </Page>
  );
}
