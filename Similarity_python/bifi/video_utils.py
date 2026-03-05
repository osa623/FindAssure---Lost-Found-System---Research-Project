import cv2

def extract_frames(video_path, max_frames=8):
    cap = cv2.VideoCapture(video_path)
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

    frames = []
    if total <= 0:
        cap.release()
        return frames

    step = max(1, total // max_frames)

    i = 0
    while len(frames) < max_frames:
        ret, frame = cap.read()
        if not ret:
            break
        if i % step == 0:
            frames.append(frame)
        i += 1

    cap.release()
    return frames
