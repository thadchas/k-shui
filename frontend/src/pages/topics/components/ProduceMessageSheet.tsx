import { useState } from 'react';
import { Send } from 'lucide-react';
import { useProduceMessage } from '@/api/hooks/messages';
import type { MessageFormat, PartitionDetail } from '@/api/types';
import { CodeEditor } from '@/components/CodeEditor';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { KeyValueEditor, pairsToRecord, type KeyValuePair } from '@/components/ui/key-value-editor';
import { Label } from '@/components/ui/label';
import { SimpleSelect } from '@/components/ui/select';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { toast, toastError } from '@/components/ui/toast';

const PRODUCE_FORMATS: MessageFormat[] = [
  'string',
  'json',
  'avro',
  'protobuf',
  'jsonschema',
  'base64',
  'hex',
];

const formatOptions = PRODUCE_FORMATS.map((f) => ({ label: f, value: f }));

export interface ProduceMessageSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cluster: string;
  topic: string;
  partitions: PartitionDetail[];
  onProduced?: () => void;
}

export function ProduceMessageSheet({
  open,
  onOpenChange,
  cluster,
  topic,
  partitions,
  onProduced,
}: ProduceMessageSheetProps) {
  const [partition, setPartition] = useState<string>('auto');
  const [keyFormat, setKeyFormat] = useState<MessageFormat>('string');
  const [valueFormat, setValueFormat] = useState<MessageFormat>('json');
  const [key, setKey] = useState('');
  const [value, setValue] = useState('{\n  \n}');
  const [headers, setHeaders] = useState<KeyValuePair[]>([]);
  const [keySubject, setKeySubject] = useState('');
  const [valueSubject, setValueSubject] = useState('');

  const produce = useProduceMessage(cluster, topic);
  const needsKeySubject = ['avro', 'protobuf', 'jsonschema'].includes(keyFormat);
  const needsValueSubject = ['avro', 'protobuf', 'jsonschema'].includes(valueFormat);

  const submit = async () => {
    try {
      const result = await produce.mutateAsync({
        partition: partition === 'auto' ? null : Number(partition),
        key: key === '' ? null : key,
        value,
        headers: pairsToRecord(headers),
        keyFormat,
        valueFormat,
        keySchemaSubject: needsKeySubject && keySubject ? keySubject : null,
        valueSchemaSubject: needsValueSubject && valueSubject ? valueSubject : null,
      });
      toast.success('Message produced', {
        description: `partition ${result.partition} · offset ${result.offset}`,
      });
      onProduced?.();
      onOpenChange(false);
    } catch (e) {
      toastError('Failed to produce message', e);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent size="lg" className="sm:max-w-[680px]">
        <SheetHeader>
          <SheetTitle>Produce message</SheetTitle>
          <SheetDescription>
            Publish a record to <span className="font-mono">{topic}</span>.
          </SheetDescription>
        </SheetHeader>

        <SheetBody className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label>Partition</Label>
              <SimpleSelect
                value={partition}
                onValueChange={setPartition}
                options={[
                  { label: 'Auto (by key)', value: 'auto' },
                  ...partitions.map((p) => ({ label: `Partition ${p.id}`, value: String(p.id) })),
                ]}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Key format</Label>
              <SimpleSelect
                value={keyFormat}
                onValueChange={(v) => setKeyFormat(v as MessageFormat)}
                options={formatOptions}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Value format</Label>
              <SimpleSelect
                value={valueFormat}
                onValueChange={(v) => setValueFormat(v as MessageFormat)}
                options={formatOptions}
              />
            </div>
          </div>

          {needsKeySubject || needsValueSubject ? (
            <div className="grid gap-4 sm:grid-cols-2">
              {needsKeySubject ? (
                <div className="space-y-1.5">
                  <Label htmlFor="key-subject">Key schema subject</Label>
                  <Input
                    id="key-subject"
                    mono
                    value={keySubject}
                    onChange={(e) => setKeySubject(e.target.value)}
                    placeholder={`${topic}-key`}
                  />
                </div>
              ) : null}
              {needsValueSubject ? (
                <div className="space-y-1.5">
                  <Label htmlFor="value-subject">Value schema subject</Label>
                  <Input
                    id="value-subject"
                    mono
                    value={valueSubject}
                    onChange={(e) => setValueSubject(e.target.value)}
                    placeholder={`${topic}-value`}
                  />
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="space-y-1.5">
            <Label>Key</Label>
            {keyFormat === 'json' ? (
              <CodeEditor value={key} onChange={setKey} language="json" height={120} />
            ) : (
              <Input
                mono
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder="(empty = null key)"
              />
            )}
          </div>

          <div className="space-y-1.5">
            <Label required>Value</Label>
            <CodeEditor
              value={value}
              onChange={setValue}
              language={
                valueFormat === 'json' || valueFormat === 'jsonschema' || valueFormat === 'avro'
                  ? 'json'
                  : 'plaintext'
              }
              height={240}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Headers</Label>
            <KeyValueEditor value={headers} onChange={setHeaders} addLabel="Add header" />
          </div>
        </SheetBody>

        <SheetFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            loading={produce.isPending}
            disabled={!value.trim()}
            onClick={() => void submit()}
          >
            <Send /> Produce
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
