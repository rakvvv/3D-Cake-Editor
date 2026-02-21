export interface AuthRequest {
  email: string;
  password: string;
}

export interface UserDto {
  id: number;
  email: string;
  role: 'USER' | 'ADMIN';
}

export interface AuthResponse {
  token: string;
  user: UserDto;
}

export interface MessageResponse {
  message: string;
}
