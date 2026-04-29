import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, Check, Plus, ChevronDown } from 'lucide-react';
import { useTenant } from '../../hooks/useTenant';
import { Badge } from '../ui';
import type { TenantWithRole } from '../../types';

interface TenantSwitcherProps {
  compact?: boolean;
}

export function TenantSwitcher({ compact }: TenantSwitcherProps) {
  const { tenants, currentTenant, setCurrentTenant } = useTenant();
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLElement | null)[]>([]);

  const handleToggle = useCallback(() => {
    setIsOpen((prev) => !prev);
  }, []);

  const handleClose = useCallback(() => {
    setIsOpen(false);
    buttonRef.current?.focus();
  }, []);

  const handleSelect = useCallback(
    (tenant: TenantWithRole) => {
      setCurrentTenant(tenant);
      setIsOpen(false);
      navigate('/', { replace: true });
    },
    [setCurrentTenant, navigate]
  );

  const handleNavigateToNewWorkspace = useCallback(() => {
    setIsOpen(false);
    navigate('/tenant');
  }, [navigate]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleClose();
      } else if (e.key === 'ArrowDown' && isOpen) {
        e.preventDefault();
        itemRefs.current[0]?.focus();
      }
    },
    [isOpen, handleClose]
  );

  const focusItem = useCallback((idx: number) => {
    const len = tenants.length + 1;
    const validIdx = ((idx % len) + len) % len;
    itemRefs.current[validIdx]?.focus();
  }, [tenants.length]);

  const onItemKeyDown = useCallback(
    (e: React.KeyboardEvent, idx: number) => {
      const len = tenants.length + 1;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        focusItem(idx + 1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        focusItem(idx - 1);
      } else if (e.key === 'Home') {
        e.preventDefault();
        focusItem(0);
      } else if (e.key === 'End') {
        e.preventDefault();
        focusItem(len - 1);
      } else if (e.key === 'Tab') {
        setIsOpen(false);
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (idx === tenants.length) {
          handleNavigateToNewWorkspace();
        } else {
          const tenant = tenants[idx];
          if (tenant && currentTenant && currentTenant.id !== tenant.id) {
            handleSelect(tenant);
          }
        }
      }
    },
    [tenants, currentTenant, focusItem, handleSelect, handleNavigateToNewWorkspace]
  );

  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const handleEscapeKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setIsOpen(false);
        buttonRef.current?.focus();
      }
    };

    document.addEventListener('keydown', handleEscapeKey);
    return () => document.removeEventListener('keydown', handleEscapeKey);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    
    itemRefs.current[0]?.focus();
  }, [isOpen]);

  if (tenants.length === 0 || !currentTenant) {
    return null;
  }

  const widthClass = compact ? 'max-w-[120px]' : 'max-w-[180px]';

  if (tenants.length === 1) {
    return (
      <span
        className={`inline-flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-300 ${widthClass}`}
        aria-label={`現在のワークスペース: ${currentTenant.name}`}
      >
        <Building2 size={16} className="shrink-0 text-neutral-400 dark:text-neutral-500" aria-hidden="true" />
        <span className="truncate font-medium">{currentTenant.name}</span>
      </span>
    );
  }

  const getRoleBadgeTone = (role: string): 'primary' | 'info' | 'neutral' => {
    switch (role) {
      case 'owner':
        return 'primary';
      case 'manager':
        return 'info';
      default:
        return 'neutral';
    }
  };

  const getRoleLabel = (role: string): string => {
    switch (role) {
      case 'owner':
        return 'Owner';
      case 'manager':
        return 'Manager';
      case 'staff':
        return 'Staff';
      default:
        return role;
    }
  };

  return (
    <div className="relative" ref={menuRef}>
      <button
        ref={buttonRef}
        type="button"
        onClick={handleToggle}
        onKeyDown={handleKeyDown}
        className={`inline-flex items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 motion-safe:transition-colors ${widthClass}`}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-label={`ワークスペース切替: 現在 ${currentTenant.name}`}
      >
        <Building2 size={16} className="shrink-0 text-neutral-500 dark:text-neutral-300" aria-hidden="true" />
        <span className="truncate">{currentTenant.name}</span>
        <ChevronDown
          size={14}
          className={`shrink-0 text-neutral-400 dark:text-neutral-500 motion-safe:transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
          aria-hidden="true"
        />
      </button>

      {isOpen && (
        <div
          className="absolute left-0 z-50 mt-2 w-72 origin-top-left rounded-md bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 py-1 shadow-lg outline-none"
          role="menu"
          aria-orientation="vertical"
          aria-label="ワークスペース一覧"
        >
          <div className="px-3 py-2 text-xs font-semibold text-neutral-500 dark:text-neutral-300 uppercase tracking-wider">
            ワークスペース
          </div>

          {tenants.map((tenant, index) => {
            const isCurrent = currentTenant.id === tenant.id;
            const tone = getRoleBadgeTone(tenant.role);
            const label = getRoleLabel(tenant.role);
            const withDot = tenant.role === 'owner' || tenant.role === 'manager';

            return (
              <div
                key={tenant.id}
                ref={(el) => {
                  itemRefs.current[index] = el;
                }}
                role="menuitem"
                tabIndex={isCurrent ? -1 : 0}
                onClick={() => {
                  if (!isCurrent) handleSelect(tenant);
                }}
                onKeyDown={(e) => onItemKeyDown(e, index)}
                className={`flex items-center gap-3 px-3 py-2.5 text-sm cursor-pointer outline-none motion-safe:transition-colors ${
                  isCurrent
                    ? 'bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300 font-semibold'
                    : 'text-neutral-700 dark:text-neutral-200 hover:bg-neutral-50 dark:hover:bg-neutral-800/50 focus:bg-neutral-50 dark:focus:bg-neutral-800/50'
                }`}
                aria-current={isCurrent ? 'true' : undefined}
              >
                <div className="w-4 h-4 flex items-center justify-center shrink-0">
                  {isCurrent ? (
                    <Check size={16} className="text-primary-600 dark:text-primary-400" aria-hidden="true" />
                  ) : (
                    <Building2 size={16} className="text-neutral-400 dark:text-neutral-500" aria-hidden="true" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="truncate font-medium">{tenant.name}</div>
                  {tenant.display_name && (
                    <div className="text-xs text-neutral-500 dark:text-neutral-300 truncate mt-0.5">
                      {tenant.display_name}
                    </div>
                  )}
                </div>
                <Badge tone={tone} withDot={withDot}>
                  {label}
                </Badge>
              </div>
            );
          })}

          <div className="my-1 h-px bg-neutral-200 dark:bg-neutral-800" role="separator" />

          <button
            type="button"
            role="menuitem"
            ref={(el) => {
              itemRefs.current[tenants.length] = el;
            }}
            onClick={handleNavigateToNewWorkspace}
            onKeyDown={(e) => onItemKeyDown(e, tenants.length)}
            className="flex w-full items-center gap-2 px-3 py-2.5 text-sm text-primary-600 dark:text-primary-400 hover:bg-neutral-50 dark:hover:bg-neutral-800/50 focus:bg-neutral-50 dark:focus:bg-neutral-800/50 focus-visible:outline-none motion-safe:transition-colors"
          >
            <Plus size={16} aria-hidden="true" />
            新しいワークスペース / 招待コードで参加
          </button>
        </div>
      )}
    </div>
  );
}
