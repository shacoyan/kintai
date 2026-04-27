import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LogOut } from 'lucide-react';
import { useTenant } from '../../hooks/useTenant';
import { useToast } from '../../contexts/ToastContext';
import { Button, BottomSheet } from '../ui';

const LeaveTenantButton: React.FC = () => {
  const { isOwner, leaveTenant } = useTenant();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [isOpen, setIsOpen] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [isLeaving, setIsLeaving] = useState(false);

  const handleLeave = async () => {
    setErrorMsg('');
    setIsLeaving(true);

    try {
      await leaveTenant();
      setIsOpen(false);
      showToast('ワークスペースから抜けました', 'success');
      navigate('/tenant');
    } catch {
      setErrorMsg('サポートに連絡してください: support@example.com');
    } finally {
      setIsLeaving(false);
    }
  };

  if (isOwner) {
    return (
      <p className="text-xs text-neutral-500">オーナーは脱退できません</p>
    );
  }

  return (
    <>
      <Button
        variant="danger"
        size="sm"
        iconLeft={<LogOut size={16} />}
        onClick={() => setIsOpen(true)}
      >
        このワークスペースから抜ける
      </Button>

      <BottomSheet
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        title="このワークスペースから抜けますか？"
        description="自分のメンバーシップが削除されます。元に戻すには再度招待コードで参加してください。"
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setIsOpen(false)}>
              キャンセル
            </Button>
            <Button
              variant="danger"
              size="sm"
              loading={isLeaving}
              onClick={handleLeave}
            >
              抜ける
            </Button>
          </>
        }
      >
        {errorMsg && (
          <p className="text-red-500 text-sm">{errorMsg}</p>
        )}
      </BottomSheet>
    </>
  );
};

export default LeaveTenantButton;
