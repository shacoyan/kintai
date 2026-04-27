import React, { useState, useEffect, useId } from 'react';
import { BottomSheet } from '../ui/BottomSheet';
import { Textarea } from '../ui/Textarea';
import { Button } from '../ui/Button';
import { ErrorBanner } from '../ui/ErrorBanner';
import { formatSupabaseError } from '../../lib/errors';

export interface RejectLeaveModalProps {
  isOpen: boolean;
  leaveId: string | null;
  onClose: () => void;
  onSubmit: (note: string) => Promise<void>;
}

export const RejectLeaveModal: React.FC<RejectLeaveModalProps> = ({
  isOpen,
  leaveId,
  onClose,
  onSubmit,
}) => {
  const [note, setNote] = useState<string>('');
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const descId = useId();

  useEffect(() => {
    if (!isOpen) {
      setNote('');
      setError(null);
    }
  }, [isOpen]);

  const handleSubmit = async () => {
    if (!leaveId) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(note.trim());
      onClose();
    } catch (err) {
      setError(formatSupabaseError(err).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <BottomSheet
      isOpen={isOpen}
      onClose={onClose}
      title="却下理由を入力"
      description="却下理由を10文字以上で入力してください"
      footer={
        <div className="flex justify-end gap-2">
          <Button
            variant="secondary"
            size="sm"
            disabled={submitting}
            onClick={onClose}
          >
            キャンセル
          </Button>
          <Button
            variant="danger"
            size="sm"
            disabled={note.trim().length < 10 || submitting}
            onClick={handleSubmit}
          >
            却下する
          </Button>
        </div>
      }
    >
      {error && <ErrorBanner message={error} />}
      <div className="space-y-1">
        <Textarea
          label="却下理由"
          required
          rows={4}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          aria-label="却下理由"
          aria-describedby={descId}
        />
        <p id={descId} className="text-sm text-neutral-500 dark:text-neutral-400">
          10文字以上で入力
        </p>
      </div>
    </BottomSheet>
  );
};
