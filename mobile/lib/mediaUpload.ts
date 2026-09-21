import * as ImagePicker from "expo-image-picker";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { storage } from "./firebase";

// Shared by post-image attachments and profile-picture uploads - picks one
// image from the device's library (square crop for avatars, free crop for
// post images) and uploads it to Firebase Storage, returning a public
// download URL to store on the post/profile doc.

export async function pickImage(options?: { square?: boolean }): Promise<string | null> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    throw new Error("Photo library access is needed to attach an image.");
  }

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    allowsEditing: true,
    aspect: options?.square ? [1, 1] : [16, 9],
    quality: 0.7,
  });

  if (result.canceled || !result.assets?.[0]) return null;
  return result.assets[0].uri;
}

export async function uploadImageAsync(localUri: string, storagePath: string): Promise<string> {
  const response = await fetch(localUri);
  const blob = await response.blob();
  const storageRef = ref(storage, storagePath);
  await uploadBytes(storageRef, blob, { contentType: blob.type || "image/jpeg" });
  return getDownloadURL(storageRef);
}
