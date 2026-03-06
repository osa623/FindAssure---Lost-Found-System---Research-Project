import axios from 'axios';

const LOCATION_MATCH_BACKEND_URL =
  process.env.LOCATION_MATCH_BACKEND_URL || 'http://127.0.0.1:5004';

export interface CategoryDataLocation {
  location: string;
  floor_id: number | string | null;
  hall_name: string | null;
}

export interface CategoryDataItem {
  id: string | number;
  description_scrore: number;
  found_location: CategoryDataLocation[];
}

export interface FindItemsRequest {
  owner_id: string | number;
  categary_name: string;
  categary_data: CategoryDataItem[];
  description_match_cofidence: number;
  owner_location: string;
  floor_id: number | string | null;
  hall_name: string | null;
  owner_location_confidence_stage: number;
}

export interface FindItemsResponse {
  location_match?: boolean;
  matched_item_ids?: Array<string | number>;
  matched_locations?: string[];
  success?: boolean;
  [key: string]: any;
}

export const findItemsByLocation = async (
  payload: FindItemsRequest
): Promise<FindItemsResponse> => {
  try {
    const response = await axios.post<FindItemsResponse>(
      `${LOCATION_MATCH_BACKEND_URL}/api/find-items`,
      payload,
      {
        headers: {
          'Content-Type': 'application/json',
        },
        timeout: 20000,
      }
    );

    return response.data;
  } catch (error: any) {
    if (error.response) {
      throw new Error(
        `Location match failed: ${error.response.data?.detail || error.response.statusText}`
      );
    }
    if (error.request) {
      throw new Error(
        'Location match service is not responding. Please ensure backend on port 5004 is running.'
      );
    }
    throw new Error(`Location match request failed: ${error.message}`);
  }
};
