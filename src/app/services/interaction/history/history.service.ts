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

  public push(domain: HistoryDomain, command: Command): void {
    const stack = this.ensure(domain);
    stack.past.push(command);
    stack.future.length = 0;
    command.do();
  }

  public undo(domain: HistoryDomain): boolean {
    const stack = this.ensure(domain);
    const command = stack.past.pop();
    if (!command) {
      return false;
    }
    command.undo();
    stack.future.push(command);
    return true;
  }

  public redo(domain: HistoryDomain): boolean {
    const stack = this.ensure(domain);
    const command = stack.future.pop();
    if (!command) {
      return false;
    }
    command.do();
    stack.past.push(command);
    return true;
  }

  public canUndo(domain: HistoryDomain): boolean {
    const stack = this.ensure(domain);
    return stack.past.length > 0;
  }

  public canRedo(domain: HistoryDomain): boolean {
    const stack = this.ensure(domain);
    return stack.future.length > 0;
  }

  private ensure(domain: HistoryDomain): HistoryStack {
    if (!this.stacks.has(domain)) {
      this.registerDomain(domain);
    }
    return this.stacks.get(domain)!;
  }
}
