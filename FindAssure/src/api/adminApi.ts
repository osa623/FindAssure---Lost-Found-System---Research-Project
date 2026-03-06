import axiosClient from './axiosClient';
import { User, AdminOverview, FoundItem } from '../types/models';

export const adminApi = {
  // Get dashboard overview statistics
  getOverview: async (): Promise<AdminOverview> => {
    const response = await axiosClient.get<AdminOverview>('/admin/overview');
    return response.data;
  },

  // Get all users
  getAllUsers: async (): Promise<User[]> => {
    const response = await axiosClient.get<User[]>('/admin/users');
    return response.data;
  },

  // Update user details
  updateUser: async (id: string, data: Partial<User>): Promise<User> => {
    const response = await axiosClient.patch<User>(`/admin/users/${id}`, data);
    return response.data;
  },

  // Suspend or unsuspend user
  updateUserSuspension: async (
    id: string,
    isSuspended: boolean,
    reason?: string,
    suspendFor?: '3d' | '7d' | 'manual'
  ): Promise<User> => {
    const response = await axiosClient.patch<User>(`/admin/users/${id}/suspension`, {
      isSuspended,
      reason,
      suspendFor,
    });
    return response.data;
  },

  // Delete user (removes from both MongoDB and Firebase)
  deleteUser: async (id: string): Promise<{ message: string; deletedUser: { id: string; email: string; name: string } }> => {
    const response = await axiosClient.delete(`/admin/users/${id}`);
    return response.data;
  },

  // Get all found items
  getAllFoundItems: async (): Promise<FoundItem[]> => {
    const response = await axiosClient.get<FoundItem[]>('/admin/found-items');
    return response.data;
  },

  // Update found item status
  updateFoundItemStatus: async (id: string, status: string): Promise<FoundItem> => {
    const response = await axiosClient.patch<FoundItem>(`/admin/found-items/${id}`, { status });
    return response.data;
  },
};
