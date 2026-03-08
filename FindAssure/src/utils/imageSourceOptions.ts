import { ActionSheetIOS, Alert, Platform } from 'react-native';

interface ImageSourceOptions {
  title?: string;
  onTakePhoto: () => void;
  onChooseFromLibrary: () => void;
}

export const showImageSourceOptions = ({
  title = 'Add Photo',
  onTakePhoto,
  onChooseFromLibrary,
}: ImageSourceOptions) => {
  if (Platform.OS === 'ios') {
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title,
        options: ['Take Photo', 'Choose from Library', 'Cancel'],
        cancelButtonIndex: 2,
      },
      (buttonIndex) => {
        if (buttonIndex === 0) onTakePhoto();
        if (buttonIndex === 1) onChooseFromLibrary();
      }
    );
    return;
  }

  Alert.alert(title, 'Choose how you want to add the image.', [
    { text: 'Take Photo', onPress: onTakePhoto },
    { text: 'Choose from Library', onPress: onChooseFromLibrary },
    { text: 'Cancel', style: 'cancel' },
  ]);
};
