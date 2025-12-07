export interface AuthRequest {
  email: string;
  password: string;
}

export interface UserDto {
  id: number;
  email: string;
}

export interface AuthResponse {
  token: string;
  user: UserDto;
}
