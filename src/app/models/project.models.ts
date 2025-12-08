export interface CakeProjectSummaryDto {
  id: number;
  name: string;
  createdAt: string;
  updatedAt: string;
  hasPainting: boolean;
}

export interface CakeProjectDetailDto {
  id: number;
  name: string;
  createdAt: string;
  updatedAt: string;
  dataJson: string;
}

export interface SaveCakeProjectRequest {
  name: string;
  dataJson: string;
}
