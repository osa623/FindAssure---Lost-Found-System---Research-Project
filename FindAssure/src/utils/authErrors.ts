type AnyError = {
  code?: string;
  message?: string;
  response?: {
    status?: number;
    data?: {
      message?: string;
      suspendedUntil?: string;
    };
  };
};

const getSuspensionMessage = (error: AnyError): string | null => {
  const status = error?.response?.status;
  if (status !== 403) {
    return null;
  }

  const backendMessage = String(error?.response?.data?.message || '').toLowerCase();
  if (!backendMessage.includes('suspend')) {
    return null;
  }

  const suspendedUntil = error?.response?.data?.suspendedUntil;
  if (suspendedUntil) {
    return `Your account is suspended until ${new Date(suspendedUntil).toLocaleString()}. Please contact support.`;
  }

  return 'Your account is currently suspended. Please contact support.';
};

export const getFriendlyAuthErrorMessage = (
  error: AnyError,
  fallback = 'Something went wrong. Please try again.'
): string => {
  const suspensionMessage = getSuspensionMessage(error);
  if (suspensionMessage) {
    return suspensionMessage;
  }

  switch (error?.code) {
    case 'auth/email-already-in-use':
      return 'This email is already registered. Please sign in instead.';
    case 'auth/invalid-email':
      return 'Please enter a valid email address.';
    case 'auth/weak-password':
      return 'Your password must be at least 6 characters long.';
    case 'auth/user-not-found':
      return 'No account was found with this email address.';
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
      return 'The email or password is incorrect. Please try again.';
    case 'auth/user-disabled':
      return 'This account has been disabled. Please contact support.';
    case 'auth/too-many-requests':
      return 'Too many attempts were made. Please wait and try again later.';
    case 'auth/network-request-failed':
      return 'Network error. Please check your internet connection and try again.';
    case 'ECONNABORTED':
      return 'The connection timed out. Please try again in a moment.';
    case 'ERR_NETWORK':
      return 'Cannot reach the server right now. Please check your connection and backend status.';
    default:
      break;
  }

  const responseStatus = error?.response?.status;
  if (responseStatus === 409) {
    return 'This account already exists. Please sign in instead.';
  }

  if (responseStatus === 401) {
    return 'Your session could not be verified. Please sign in again.';
  }

  if (responseStatus === 503 || responseStatus === 502 || responseStatus === 500) {
    return 'The server is unavailable right now. Please try again shortly.';
  }

  const rawMessage = String(error?.message || '');
  if (rawMessage.toLowerCase().includes('timeout')) {
    return 'The connection timed out. Please try again in a moment.';
  }

  return fallback;
};
