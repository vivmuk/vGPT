import { Stack } from "expo-router";
import { Head } from "expo-router";

export default function RootLayout() {
  return (
    <>
      <Head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@100..900&display=swap" rel="stylesheet" />
      </Head>
      <Stack screenOptions={{ headerShown: false }} />
    </>
  );
}
