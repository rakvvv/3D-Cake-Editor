import {Injectable} from '@angular/core';
import {Command, HistoryDomain} from '../types/interaction-types';

interface HistoryStack {
  past: Command[];
  future: Command[];
}

@Injectable({providedIn: 'root'})
export class HistoryService {
  private stacks = new Map<HistoryDomain, HistoryStack>();

  public registerDomain(domain: HistoryDomain): void {
    if (!this.stacks.has(domain)) {
      this.stacks.set(domain, {past: [], future: []});
    }
  }

  public push(domain: HistoryDomain, command: Command, options?: {execute?: boolean}): void {
    const stack = this.ensure(domain);
    stack.past.push(command);
    stack.future.length = 0;
    if (options?.execute !== false) {
      command.do();
    }
  }

  public undo<TResult = unknown>(domain: HistoryDomain): TResult | undefined {
    const stack = this.ensure(domain);
    const command = stack.past.pop();
    if (!command) {
      return undefined;
    }
    const result = (command as Command<TResult>).undo();
    stack.future.push(command);
    return result;
  }

  public redo<TResult = unknown>(domain: HistoryDomain): TResult | undefined {
    const stack = this.ensure(domain);
    const command = stack.future.pop();
    if (!command) {
      return undefined;
    }
    const result = (command as Command<TResult>).do();
    stack.past.push(command);
    return result;
  }

  public canUndo(domain: HistoryDomain): boolean {
    const stack = this.ensure(domain);
    return stack.past.length > 0;
  }

  public canRedo(domain: HistoryDomain): boolean {
    const stack = this.ensure(domain);
    return stack.future.length > 0;
  }

  public resetDomain(domain: HistoryDomain): void {
    this.stacks.set(domain, {past: [], future: []});
  }

  public resetAll(): void {
    this.stacks.clear();
  }

  private ensure(domain: HistoryDomain): HistoryStack {
    if (!this.stacks.has(domain)) {
      this.registerDomain(domain);
    }
    return this.stacks.get(domain)!;
  }
}
