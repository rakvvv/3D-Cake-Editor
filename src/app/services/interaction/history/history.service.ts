import {Injectable} from '@angular/core';
import {Command, HistoryDomain} from '../types/interaction-types';

interface HistoryStack {
  past: Command[];
  future: Command[];
}

@Injectable({providedIn: 'root'})
export class HistoryService {
  private stacks = new Map<HistoryDomain, HistoryStack>();
  private globalPast: Array<{domain: HistoryDomain; command: Command}> = [];
  private globalFuture: Array<{domain: HistoryDomain; command: Command}> = [];

  public registerDomain(domain: HistoryDomain): void {
    if (!this.stacks.has(domain)) {
      this.stacks.set(domain, {past: [], future: []});
    }
  }

  public push(domain: HistoryDomain, command: Command, options?: {execute?: boolean}): void {
    const stack = this.ensure(domain);
    stack.past.push(command);
    stack.future.length = 0;
    this.globalPast.push({domain, command});
    this.globalFuture.length = 0;
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
    this.relocateLatestGlobalEntry(domain, this.globalPast, this.globalFuture);
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
    this.relocateLatestGlobalEntry(domain, this.globalFuture, this.globalPast);
    return result;
  }

  public undoAny<TResult = unknown>(): TResult | undefined {
    const entry = this.globalPast.pop();
    if (!entry) return undefined;

    const stack = this.ensure(entry.domain);
    const popped = stack.past.pop();
    const command = popped ?? entry.command;

    const result = (command as Command<TResult>).undo();
    stack.future.push(command);
    this.globalFuture.push({domain: entry.domain, command});
    return result;
  }

  public redoAny<TResult = unknown>(): TResult | undefined {
    const entry = this.globalFuture.pop();
    if (!entry) return undefined;

    const stack = this.ensure(entry.domain);
    const popped = stack.future.pop();
    const command = popped ?? entry.command;

    const result = (command as Command<TResult>).do();
    stack.past.push(command);
    this.globalPast.push({domain: entry.domain, command});
    return result;
  }

  public canUndoAny(): boolean {
    return this.globalPast.length > 0;
  }

  public canRedoAny(): boolean {
    return this.globalFuture.length > 0;
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
    this.globalPast = this.globalPast.filter((entry) => entry.domain !== domain);
    this.globalFuture = this.globalFuture.filter((entry) => entry.domain !== domain);
  }

  public resetAll(): void {
    this.stacks.clear();
    this.globalPast = [];
    this.globalFuture = [];
  }

  private ensure(domain: HistoryDomain): HistoryStack {
    if (!this.stacks.has(domain)) {
      this.registerDomain(domain);
    }
    return this.stacks.get(domain)!;
  }

  private relocateLatestGlobalEntry(domain: HistoryDomain, from: Array<{domain: HistoryDomain; command: Command}>, to: Array<{domain: HistoryDomain; command: Command}>): void {
    for (let i = from.length - 1; i >= 0; i--) {
      if (from[i].domain === domain) {
        const [entry] = from.splice(i, 1);
        to.push(entry);
        return;
      }
    }
  }
}
