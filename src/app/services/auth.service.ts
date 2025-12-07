import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, tap } from 'rxjs';
import { environment } from '../../environments/environment';
import { AuthRequest, AuthResponse, UserDto } from '../models/auth.models';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly tokenKey = 'authToken';
  private readonly userKey = 'authUser';
  private readonly baseUrl = `${environment.apiBaseUrl}/auth`;
  private currentUserSubject = new BehaviorSubject<UserDto | null>(this.readStoredUser());

  constructor(private http: HttpClient) {}

  login(email: string, password: string): Observable<AuthResponse> {
    const payload: AuthRequest = { email, password };
    return this.http.post<AuthResponse>(`${this.baseUrl}/login`, payload).pipe(tap((response) => this.persistSession(response)));
  }

  register(email: string, password: string): Observable<AuthResponse> {
    const payload: AuthRequest = { email, password };
    return this.http
      .post<AuthResponse>(`${this.baseUrl}/register`, payload)
      .pipe(tap((response) => this.persistSession(response)));
  }

  me(): Observable<UserDto> {
    return this.http.get<UserDto>(`${this.baseUrl}/me`).pipe(tap((user) => this.storeUser(user)));
  }

  logout(): void {
    if (this.hasStorage()) {
      localStorage.removeItem(this.tokenKey);
      localStorage.removeItem(this.userKey);
    }
    this.currentUserSubject.next(null);
  }

  get currentUser$(): Observable<UserDto | null> {
    return this.currentUserSubject.asObservable();
  }

  getCurrentUser(): UserDto | null {
    return this.currentUserSubject.getValue();
  }

  isAuthenticated(): boolean {
    return !!this.getToken();
  }

  getToken(): string | null {
    if (!this.hasStorage()) {
      return null;
    }
    return localStorage.getItem(this.tokenKey);
  }

  private persistSession(response: AuthResponse): void {
    if (this.hasStorage()) {
      localStorage.setItem(this.tokenKey, response.token);
    }
    this.storeUser(response.user);
  }

  private storeUser(user: UserDto): void {
    if (this.hasStorage()) {
      localStorage.setItem(this.userKey, JSON.stringify(user));
    }
    this.currentUserSubject.next(user);
  }

  private readStoredUser(): UserDto | null {
    if (!this.hasStorage()) {
      return null;
    }

    const stored = localStorage.getItem(this.userKey);
    if (!stored) {
      return null;
    }

    try {
      return JSON.parse(stored) as UserDto;
    } catch (err) {
      return null;
    }
  }

  private hasStorage(): boolean {
    return typeof localStorage !== 'undefined';
  }
}
