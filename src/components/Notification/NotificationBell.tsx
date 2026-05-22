import { useState, useRef, useEffect } from 'react';
import { Bell } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useTenant } from '../../contexts/TenantContext';
import { useNotification } from '../../hooks/useNotification';
import { BottomSheet, EmptyState, Heading } from '../ui';
import type { NotificationItem } from '../../types';
import { messages } from '../../lib/messages';

function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 60) return 'たった今';
  if (diffMin < 60) return `${diffMin} 分前`;
  if (diffHour < 24) return `${diffHour} 時間前`;
  if (diffDay < 7) return `${diffDay} 日前`;

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}/${month}/${day}`;
}

export function NotificationBell() {
  const { user } = useAuth();
  const { currentTenant } = useTenant();

  if (!user || !currentTenant) return null;

  return <NotificationBellInner userId={user.id} />;
}

function NotificationBellInner({ userId }: { userId: string }) {
  const navigate = useNavigate();
  const { notifications, unreadCount, markAsRead, markAllAsRead, fetchAll } =
    useNotification(userId);

  const [isOpen, setIsOpen] = useState(false);
  const [isAllOpen, setIsAllOpen] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isOpen) setIsOpen(false);
        if (isAllOpen) setIsAllOpen(false);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isAllOpen]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        isOpen &&
        containerRef.current &&
        !containerRef.current.contains(e.target as Node) &&
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const handleNotificationClick = (notification: NotificationItem) => {
    void markAsRead(notification.id);
    if (notification.link) {
      navigate(notification.link);
    }
    setIsOpen(false);
  };

  const handleViewAllClick = () => {
    setIsOpen(false);
    void fetchAll(100);
    setIsAllOpen(true);
  };

  const handleMarkAllRead = () => {
    void markAllAsRead();
  };

  const getBadgeText = (): string | null => {
    if (unreadCount === 0) return null;
    if (unreadCount >= 10) return '9+';
    return String(unreadCount);
  };

  const badgeText = getBadgeText();

  const renderNotificationItem = (notification: NotificationItem) => {
    const isUnread = notification.read_at === null;
    return (
      <button
        key={notification.id}
        type="button"
        role="menuitem"
        className="w-full text-left px-4 py-3 hover:bg-stone-50 dark:hover:bg-stone-800 flex items-start gap-2 motion-safe:transition-colors duration-150 ease-out"
        onClick={() => handleNotificationClick(notification)}
      >
        {isUnread ? (
          <span
            aria-hidden="true"
            className="mt-1.5 flex-shrink-0 w-2 h-2 rounded-full bg-blue-500 dark:bg-blue-400"
          />
        ) : (
          <span aria-hidden="true" className="mt-1.5 flex-shrink-0 w-2 h-2" />
        )}
        <div className="flex-1 min-w-0">
          <p className="font-medium text-sm text-stone-900 dark:text-stone-100 truncate">
            {notification.title}
          </p>
          {notification.body && (
            <p className="text-sm text-stone-500 dark:text-stone-300 mt-0.5 line-clamp-2">
              {notification.body}
            </p>
          )}
          <p className="text-xs text-stone-400 dark:text-stone-500 mt-1">
            {formatRelativeTime(notification.created_at)}
          </p>
        </div>
      </button>
    );
  };

  const latestNotifications = notifications.slice(0, 10);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        className="relative p-2 rounded-md text-stone-600 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-800 motion-safe:transition-colors duration-150 ease-out"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-label={`通知 ${unreadCount}件未読`}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-controls="notification-popover"
      >
        <Bell size={18} />
        {badgeText && (
          <span className="absolute top-0 right-0 bg-red-500 dark:bg-red-400 text-white text-[10px] rounded-full min-w-[16px] h-4 flex items-center justify-center px-1 font-medium leading-none">
            {badgeText}
          </span>
        )}
      </button>

      {isOpen && (
        <div
          ref={popoverRef}
          id="notification-popover"
          role="menu"
          className="absolute right-0 top-full mt-2 w-80 max-h-[480px] rounded-md bg-white shadow-lg border border-stone-200 dark:bg-stone-900 dark:border-stone-800 py-2 z-50 overflow-y-auto"
        >
          <div className="flex items-center justify-between px-4 py-2 border-b border-stone-100 dark:border-stone-800 mb-1">
            <Heading level={4}>
              通知
            </Heading>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={handleMarkAllRead}
                className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
              >
                すべて既読にする
              </button>
            )}
          </div>

          <div>
            {notifications.length === 0 ? (
              <div className="px-4 py-4">
                <EmptyState title={messages.empty.notification.title} />
              </div>
            ) : (
              <div className="divide-y divide-stone-50 dark:divide-stone-800">
                {latestNotifications.map(renderNotificationItem)}
              </div>
            )}
          </div>

          {notifications.length > 0 && (
            <div className="px-4 pt-2 mt-1 border-t border-stone-100 dark:border-stone-800">
              <button
                type="button"
                onClick={handleViewAllClick}
                className="w-full text-center text-sm text-blue-600 dark:text-blue-400 hover:underline py-2"
              >
                通知をすべて見る
              </button>
            </div>
          )}
        </div>
      )}

      <BottomSheet
        isOpen={isAllOpen}
        onClose={() => setIsAllOpen(false)}
        title="すべての通知"
      >
        <div className="py-2">
          {notifications.length === 0 ? (
            <div className="px-4 py-4">
              <EmptyState title={messages.empty.notification.title} />
            </div>
          ) : (
            <div className="divide-y divide-stone-100 dark:divide-stone-800">
              {notifications.map(renderNotificationItem)}
            </div>
          )}
        </div>
      </BottomSheet>
    </div>
  );
}
