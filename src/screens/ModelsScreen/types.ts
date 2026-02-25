import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ModelSource } from '../../types';
import { RootStackParamList } from '../../navigation/types';

export type BackendFilter = 'all' | 'mnn' | 'qnn' | 'coreml';

export interface ImageModelDescriptor {
  id: string;
  name: string;
  description: string;
  downloadUrl: string;
  size: number;
  style: string;
  backend: 'mnn' | 'qnn' | 'coreml';
  variant?: string;
  huggingFaceRepo?: string;
  huggingFaceFiles?: { path: string; size: number }[];
  /** Multi-file download manifest (Core ML full-precision models) */
  coremlFiles?: { path: string; relativePath: string; size: number; downloadUrl: string }[];
  /** HuggingFace repo slug (e.g. 'apple/coreml-stable-diffusion-2-1-base-palettized') */
  repo?: string;
}

export type CredibilityFilter = 'all' | ModelSource;
export type ModelTypeFilter = 'all' | 'text' | 'vision' | 'code' | 'image-gen';
export type SizeFilter = 'all' | 'tiny' | 'small' | 'medium' | 'large';
export type FilterDimension = 'org' | 'type' | 'source' | 'size' | 'quant' | null;
export type ImageFilterDimension = 'backend' | 'style' | 'sdVersion' | null;
export type ModelTab = 'text' | 'image';

export interface FilterState {
  orgs: string[];
  type: ModelTypeFilter;
  source: CredibilityFilter;
  size: SizeFilter;
  quant: string;
  expandedDimension: FilterDimension;
}

export type NavigationProp = NativeStackNavigationProp<RootStackParamList>;
