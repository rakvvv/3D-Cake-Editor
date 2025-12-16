export interface CakeProjectSummaryDto {
  id: number;
  name: string;
  createdAt: string;
  updatedAt: string;
  hasPainting: boolean;
  thumbnailUrl?: string | null;
}

export interface CakeProjectDetailDto {
  id: number;
  name: string;
  createdAt: string;
  updatedAt: string;
  dataJson: string;
  thumbnailUrl?: string | null;
}

export interface SaveCakeProjectRequest {
  name: string;
  dataJson: string;
}
