import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmDestructiveDialog } from './ConfirmDestructiveDialog';

function setup(props: Partial<React.ComponentProps<typeof ConfirmDestructiveDialog>> = {}) {
  const onConfirm = vi.fn();
  render(
    <ConfirmDestructiveDialog
      open
      onOpenChange={() => {}}
      title="Delete topic"
      confirmLabel="Delete"
      onConfirm={onConfirm}
      {...props}
    />,
  );
  return { onConfirm, button: () => screen.getByRole('button', { name: /^delete$/i }) };
}

describe('ConfirmDestructiveDialog', () => {
  it('requires the exact confirmText before enabling the action', async () => {
    const user = userEvent.setup();
    const { button, onConfirm } = setup({ confirmText: 'orders' });
    expect(button()).toBeDisabled();
    await user.type(screen.getByRole('textbox'), 'order');
    expect(button()).toBeDisabled();
    await user.type(screen.getByRole('textbox'), 's');
    expect(button()).toBeEnabled();
    await user.click(button());
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('requires the acknowledgement checkbox when acknowledgeLabel is set', async () => {
    const user = userEvent.setup();
    const { button } = setup({ acknowledgeLabel: 'I understand' });
    expect(button()).toBeDisabled();
    await user.click(screen.getByRole('checkbox'));
    expect(button()).toBeEnabled();
  });

  it('honours the caller-side disabled gate', () => {
    const { button } = setup({ disabled: true, disabledReason: 'Offsets out of range' });
    expect(button()).toBeDisabled();
    expect(button()).toHaveAttribute('title', 'Offsets out of range');
  });

  it('keeps Cancel enabled while loading', () => {
    setup({ loading: true });
    expect(screen.getByRole('button', { name: /cancel/i })).toBeEnabled();
  });
});
