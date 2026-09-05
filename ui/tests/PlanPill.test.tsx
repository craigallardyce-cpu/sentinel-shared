import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { PlanPill } from '../src/PlanPill';

afterEach(() => {
  cleanup();
});

describe('PlanPill', () => {
  it('renders nothing at all while the plan is not yet known', () => {
    const { container } = render(<PlanPill planLabel={null} onManage={vi.fn()} onConvert={vi.fn()} trial daysLeft={3} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the plan name on a paid plan', () => {
    render(<PlanPill planLabel="Premium Suite" onManage={vi.fn()} />);
    expect(screen.getByText('Premium Suite')).toBeInTheDocument();
    expect(screen.queryByText(/trial/i)).not.toBeInTheDocument();
  });

  it('offers no convert action on a paid plan, even when one is passed', () => {
    render(<PlanPill planLabel="Premium Suite" onManage={vi.fn()} onConvert={vi.fn()} />);
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.queryByText('Upgrade')).not.toBeInTheDocument();
  });

  it('says it is a trial and how much is left', () => {
    render(<PlanPill planLabel="Premium Suite" trial daysLeft={12} onManage={vi.fn()} onConvert={vi.fn()} />);
    expect(screen.getByText('Trial — 12 days left')).toBeInTheDocument();
  });

  it('reads a single remaining day as "1 day left", not "1 days left"', () => {
    render(<PlanPill planLabel="Premium Suite" trial daysLeft={1} onManage={vi.fn()} />);
    expect(screen.getByText('Trial — 1 day left')).toBeInTheDocument();
  });

  it('reads daysLeft 0 as the last day rather than "0 days"', () => {
    render(<PlanPill planLabel="Premium Suite" trial daysLeft={0} onManage={vi.fn()} />);
    expect(screen.getByText('Trial — last day')).toBeInTheDocument();
    expect(screen.queryByText(/0 days/)).not.toBeInTheDocument();
  });

  it('still says it is a trial when daysLeft is null, without inventing a number', () => {
    render(<PlanPill planLabel="Premium Suite" trial daysLeft={null} onManage={vi.fn()} />);
    expect(screen.getByText('Trial')).toBeInTheDocument();
    expect(screen.queryByText(/day/i)).not.toBeInTheDocument();
  });

  it('says it is a trial when daysLeft is omitted entirely', () => {
    render(<PlanPill planLabel="Premium Suite" trial onManage={vi.fn()} />);
    expect(screen.getByText('Trial')).toBeInTheDocument();
  });

  it('names the plan in the accessible name, not just the visible text', () => {
    render(<PlanPill planLabel="Premium Suite" trial daysLeft={12} onManage={vi.fn()} onConvert={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Premium Suite trial, 12 days left. Manage or cancel your plan.' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Upgrade from your Premium Suite trial to a paid plan.' })).toBeInTheDocument();
  });

  it('gives the paid pill an accessible name that stands on its own', () => {
    render(<PlanPill planLabel="Premium Suite" onManage={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Premium Suite plan. Manage or cancel your plan.' })).toBeInTheDocument();
  });

  it('calls onManage when the pill is activated', () => {
    const onManage = vi.fn();
    render(<PlanPill planLabel="Premium Suite" onManage={onManage} />);
    fireEvent.click(screen.getByRole('button', { name: /Manage or cancel/ }));
    expect(onManage).toHaveBeenCalledTimes(1);
  });

  it('calls onConvert from the trial upgrade action', () => {
    const onManage = vi.fn();
    const onConvert = vi.fn();
    render(<PlanPill planLabel="Premium Suite" trial daysLeft={5} onManage={onManage} onConvert={onConvert} />);
    fireEvent.click(screen.getByRole('button', { name: /Upgrade from your/ }));
    expect(onConvert).toHaveBeenCalledTimes(1);
    expect(onManage).not.toHaveBeenCalled();
  });

  it('omits the upgrade action on a trial with no onConvert', () => {
    render(<PlanPill planLabel="Premium Suite" trial daysLeft={5} onManage={vi.fn()} />);
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  it('uses real buttons, so the pill is keyboard reachable', () => {
    render(<PlanPill planLabel="Premium Suite" trial daysLeft={2} onManage={vi.fn()} onConvert={vi.fn()} />);
    for (const button of screen.getAllByRole('button')) {
      expect(button).toHaveAttribute('type', 'button');
      expect(button.className).toContain('focus-visible:ring-2');
    }
  });

  it('takes the warning surface in the last days of a trial and the calm one before that', () => {
    const { container: ending } = render(<PlanPill planLabel="Premium Suite" trial daysLeft={2} onManage={vi.fn()} />);
    expect(ending.querySelector('.text-warning')).toBeTruthy();
    cleanup();

    const { container: healthy } = render(<PlanPill planLabel="Premium Suite" trial daysLeft={20} onManage={vi.fn()} />);
    expect(healthy.querySelector('.text-warning')).toBeNull();
    expect(healthy.querySelector('.text-cyan')).toBeTruthy();
  });

  it('keeps a paid plan quieter than any status the header carries', () => {
    const { container } = render(<PlanPill planLabel="Premium Suite" onManage={vi.fn()} />);
    expect(container.querySelector('.text-text-muted')).toBeTruthy();
    expect(container.querySelector('.text-green')).toBeNull();
    expect(container.querySelector('.text-red')).toBeNull();
    expect(container.querySelector('.animate-ping')).toBeNull();
  });

  it('clamps a trial the caller let go negative to the last day', () => {
    render(<PlanPill planLabel="Premium Suite" trial daysLeft={-4} onManage={vi.fn()} />);
    expect(screen.getByText('Trial — last day')).toBeInTheDocument();
  });
});
