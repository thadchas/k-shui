import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { ArrowLeft, FileJson, ShieldCheck, Wand2 } from 'lucide-react';
import {
  useCheckCompatibilityForSubject,
  useRegisterSchemaForSubject,
  useSchemaSubjects,
} from '@/api/hooks/schemas';
import { useTopics } from '@/api/hooks/topics';
import type { SchemaReference, SchemaType } from '@/api/types';
import { useClusterId } from '@/hooks/useClusterId';
import { CodeEditor } from '@/components/CodeEditor';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/ui/page-header';
import { SimpleSelect } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { toast, toastError } from '@/components/ui/toast';
import { CompatibilityResult } from './components/CompatibilityResult';
import { SchemaReferencesEditor } from './components/SchemaReferencesEditor';
import {
  SCHEMA_TYPES,
  SUBJECT_STRATEGIES,
  buildSubjectName,
  editorLanguageForSchema,
  schemaTemplate,
  type SubjectStrategy,
} from './components/schemaUtils';

export function NewSchemaPage() {
  const cluster = useClusterId();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const presetSubject = searchParams.get('subject') ?? '';
  const presetType = (searchParams.get('type') as SchemaType | null) ?? 'AVRO';

  const [subject, setSubject] = useState(presetSubject);
  const [schemaType, setSchemaType] = useState<SchemaType>(
    SCHEMA_TYPES.includes(presetType) ? presetType : 'AVRO',
  );
  const [schema, setSchema] = useState(() => schemaTemplate(presetType ?? 'AVRO'));
  const [references, setReferences] = useState<SchemaReference[]>([]);
  const [normalize, setNormalize] = useState(false);
  const [helperOpen, setHelperOpen] = useState(!presetSubject);
  const [strategy, setStrategy] = useState<SubjectStrategy>('TopicNameStrategy');
  const [topic, setTopic] = useState('');
  const [part, setPart] = useState<'key' | 'value'>('value');
  const [recordName, setRecordName] = useState('');
  const [touchedSchema, setTouchedSchema] = useState(false);

  const topics = useTopics(cluster, { perPage: 500 });
  const subjects = useSchemaSubjects(cluster);
  const register = useRegisterSchemaForSubject(cluster);
  const check = useCheckCompatibilityForSubject(cluster);

  const existingSubjects = useMemo(
    () => (subjects.data ?? []).map((s) => s.subject),
    [subjects.data],
  );

  const topicNames = useMemo(() => (topics.data?.items ?? []).map((t) => t.name), [topics.data]);

  const suggestions = useMemo(() => {
    const set = new Set<string>(existingSubjects);
    for (const name of topicNames) {
      set.add(`${name}-value`);
      set.add(`${name}-key`);
    }
    return Array.from(set).sort();
  }, [existingSubjects, topicNames]);

  /* Keep the template in sync with the schema type until the user edits it. */
  useEffect(() => {
    if (!touchedSchema) setSchema(schemaTemplate(schemaType));
  }, [schemaType, touchedSchema]);

  const helperSubject = buildSubjectName(strategy, topic, part, recordName);

  const isNewVersion = existingSubjects.includes(subject);

  const jsonError = useMemo(() => {
    if (schemaType === 'PROTOBUF') return null;
    if (!schema.trim()) return 'Schema is empty';
    try {
      JSON.parse(schema);
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : 'Invalid JSON';
    }
  }, [schema, schemaType]);

  const canSubmit = Boolean(subject.trim()) && Boolean(schema.trim()) && !jsonError;

  const cleanReferences = () =>
    references.filter((r) => r.name.trim() && r.subject.trim()).map((r) => ({ ...r }));

  const onCheck = async () => {
    try {
      await check.mutateAsync({ subject: subject.trim(), schema, schemaType });
    } catch (e) {
      toastError('Compatibility check failed', e);
    }
  };

  const onRegister = async () => {
    try {
      const result = await register.mutateAsync({
        subject: subject.trim(),
        schema,
        schemaType,
        references: cleanReferences(),
        normalize: normalize || undefined,
      });
      toast.success(`Registered schema id ${result?.id ?? ''}`.trim());
      void navigate(`/c/${cluster}/schemas/${encodeURIComponent(subject.trim())}`);
    } catch (e) {
      toastError('Failed to register schema', e);
    }
  };

  return (
    <div>
      <PageHeader
        title="Register schema"
        description="Add a new subject, or a new version of an existing subject, to the registry."
        actions={
          <>
            <Button variant="outline" asChild>
              <Link to={`/c/${cluster}/schemas`}>
                <ArrowLeft /> All schemas
              </Link>
            </Button>
            <Button
              variant="outline"
              disabled={!canSubmit || !isNewVersion}
              loading={check.isPending}
              onClick={() => void onCheck()}
            >
              <ShieldCheck /> Check compatibility
            </Button>
            <Button
              disabled={!canSubmit}
              loading={register.isPending}
              onClick={() => void onRegister()}
            >
              <FileJson /> Register
            </Button>
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(320px,420px)_1fr]">
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Subject</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="subject">Subject name</Label>
                <Input
                  id="subject"
                  mono
                  list="schema-subject-suggestions"
                  autoComplete="off"
                  placeholder="orders.public.order-created.v1-value"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                />
                <datalist id="schema-subject-suggestions">
                  {suggestions.map((s) => (
                    <option key={s} value={s} />
                  ))}
                </datalist>
                <p className="text-2xs text-[var(--muted)]">
                  {isNewVersion
                    ? 'Existing subject — this registers a new version.'
                    : 'New subject — suggestions come from your topics and existing subjects.'}
                </p>
              </div>

              <div className="rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--surface-2)] p-3">
                <button
                  type="button"
                  className="flex w-full items-center justify-between text-xs font-medium text-[var(--foreground)]"
                  onClick={() => setHelperOpen((v) => !v)}
                  aria-expanded={helperOpen}
                >
                  <span className="flex items-center gap-1.5">
                    <Wand2 className="size-3.5 text-[var(--primary)]" /> Subject name helper
                  </span>
                  <span className="text-[var(--muted)]">{helperOpen ? 'Hide' : 'Show'}</span>
                </button>

                {helperOpen ? (
                  <div className="mt-3 space-y-3">
                    <div className="space-y-1.5">
                      <Label>Strategy</Label>
                      <SimpleSelect
                        value={strategy}
                        onValueChange={(v) => setStrategy(v as SubjectStrategy)}
                        options={SUBJECT_STRATEGIES.map((s) => ({
                          label: s.label,
                          value: s.value,
                        }))}
                        aria-label="Subject naming strategy"
                      />
                      <p className="text-2xs text-[var(--muted)]">
                        {SUBJECT_STRATEGIES.find((s) => s.value === strategy)?.hint}
                      </p>
                    </div>

                    {strategy !== 'RecordNameStrategy' ? (
                      <div className="space-y-1.5">
                        <Label htmlFor="helper-topic">Topic</Label>
                        <Input
                          id="helper-topic"
                          mono
                          list="schema-topic-suggestions"
                          autoComplete="off"
                          value={topic}
                          onChange={(e) => setTopic(e.target.value)}
                          placeholder="orders.public.order-created.v1"
                        />
                        <datalist id="schema-topic-suggestions">
                          {topicNames.map((t) => (
                            <option key={t} value={t} />
                          ))}
                        </datalist>
                      </div>
                    ) : null}

                    {strategy === 'TopicNameStrategy' ? (
                      <div className="space-y-1.5">
                        <Label>Part</Label>
                        <SimpleSelect
                          value={part}
                          onValueChange={(v) => setPart(v as 'key' | 'value')}
                          options={[
                            { label: 'value', value: 'value' },
                            { label: 'key', value: 'key' },
                          ]}
                          aria-label="Key or value"
                        />
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        <Label htmlFor="helper-record">Record name</Label>
                        <Input
                          id="helper-record"
                          mono
                          autoComplete="off"
                          value={recordName}
                          onChange={(e) => setRecordName(e.target.value)}
                          placeholder="com.example.OrderCreated"
                        />
                      </div>
                    )}

                    <div className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate font-mono text-2xs text-[var(--muted)]">
                        {helperSubject || '—'}
                      </span>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!helperSubject}
                        onClick={() => setSubject(helperSubject)}
                      >
                        Use
                      </Button>
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="space-y-1.5">
                <Label>Schema type</Label>
                <SimpleSelect
                  value={schemaType}
                  onValueChange={(v) => setSchemaType(v as SchemaType)}
                  options={SCHEMA_TYPES.map((t) => ({ label: t, value: t }))}
                  aria-label="Schema type"
                />
              </div>

              <label className="flex items-center gap-2 text-xs text-[var(--muted)]">
                <Switch
                  checked={normalize}
                  onCheckedChange={setNormalize}
                  aria-label="Normalize schema"
                />
                Normalize schema before registering
              </label>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>References</CardTitle>
            </CardHeader>
            <CardContent>
              <SchemaReferencesEditor
                value={references}
                onChange={setReferences}
                subjectOptions={existingSubjects}
              />
            </CardContent>
          </Card>
        </div>

        <Card className="min-w-0">
          <CardHeader className="flex-row items-center justify-between gap-2">
            <CardTitle>Schema</CardTitle>
            <span className="text-2xs text-[var(--muted)]">
              {schemaType === 'PROTOBUF' ? 'protobuf' : 'json'}
            </span>
          </CardHeader>
          <CardContent className="space-y-3">
            <CodeEditor
              value={schema}
              onChange={(v) => {
                setTouchedSchema(true);
                setSchema(v);
              }}
              language={editorLanguageForSchema(schemaType)}
              height={520}
              minimal={false}
              ariaLabel="Schema definition"
            />
            {jsonError ? (
              <p className="font-mono text-2xs text-[var(--danger)]">{jsonError}</p>
            ) : null}
            <CompatibilityResult result={check.data} />
            {!isNewVersion ? (
              <p className="text-2xs text-[var(--muted)]">
                Compatibility can only be checked against an existing subject.
              </p>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default NewSchemaPage;
