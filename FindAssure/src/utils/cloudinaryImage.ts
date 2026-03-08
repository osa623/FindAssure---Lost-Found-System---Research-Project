const CLOUDINARY_UPLOAD_SEGMENT = '/upload/';

const isRemoteUrl = (value: string) => /^https?:\/\//i.test(value);

const hasFormatTransform = (segment: string) => /(?:^|,)f_[a-z0-9]+(?:,|$)/i.test(segment);

export const getDisplayImageUri = (uri?: string | null): string | undefined => {
  if (!uri) {
    return undefined;
  }

  const trimmed = uri.trim();
  if (!trimmed || !isRemoteUrl(trimmed) || !trimmed.includes('res.cloudinary.com') || !trimmed.includes(CLOUDINARY_UPLOAD_SEGMENT)) {
    return trimmed;
  }

  const [base, query = ''] = trimmed.split('?');
  const uploadIndex = base.indexOf(CLOUDINARY_UPLOAD_SEGMENT);
  if (uploadIndex === -1) {
    return trimmed;
  }

  const prefix = base.slice(0, uploadIndex + CLOUDINARY_UPLOAD_SEGMENT.length);
  const suffix = base.slice(uploadIndex + CLOUDINARY_UPLOAD_SEGMENT.length);

  if (!suffix) {
    return trimmed;
  }

  const firstSegment = suffix.split('/')[0] || '';
  if (hasFormatTransform(firstSegment)) {
    return trimmed;
  }

  const transformed = `${prefix}f_jpg,q_auto/${suffix}`;
  return query ? `${transformed}?${query}` : transformed;
};
