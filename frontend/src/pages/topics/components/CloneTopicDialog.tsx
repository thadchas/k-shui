import { useEffect, useState } from 'react';
import { useCloneTopic } from '@/api/hooks/topics';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast, toastError } from '@/components/ui/toast';

export interface CloneTopicDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cluster: string;
  topic: string | null;
  onCloned?: (name: string) => void;
}

export function CloneTopicDialog({
  open,
  onOpenChange,
  cluster,
  topic,
  onCloned,
}: CloneTopicDialogProps) {
  const name = topic ?? '';
  const [cloneName, setCloneName] = useState(`${name}-copy`);
  const cloneTopic = useCloneTopic(cluster, name);

  useEffect(() => {
    if (open) setCloneName(`${name}-copy`);
  }, [open, name]);

  const submit = async () => {
    const target = cloneName.trim();
    if (!target) return;
    try {
      await cloneTopic.mutateAsync({ name: target });
      toast.success(`Cloned to ${target}`);
      onOpenChange(false);
      onCloned?.(target);
    } catch (e) {
      toastError('Failed to clone topic', e);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Clone topic</DialogTitle>
          <DialogDescription>
            Creates a new topic with the same partition count, replication factor and configs as{' '}
            <span className="font-mono">{name}</span>. Records are not copied.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-2">
          <Label htmlFor="clone-name">New topic name</Label>
          <Input
            id="clone-name"
            mono
            value={cloneName}
            onChange={(e) => setCloneName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submit();
            }}
          />
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            loading={cloneTopic.isPending}
            disabled={!cloneName.trim() || cloneName.trim() === name}
            onClick={() => void submit()}
          >
            Clone
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
