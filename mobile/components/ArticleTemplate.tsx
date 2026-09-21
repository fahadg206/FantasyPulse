import { View, Text, Image, ScrollView, Platform } from "react-native";
import { LinearGradient } from "expo-linear-gradient";

function generateParagraphs(article: any) {
  if (!article) return [];
  const paragraphs: string[] = [];
  for (let i = 1; i <= Object.keys(article).length; i++) {
    if (article[`paragraph${i}`]) paragraphs.push(article[`paragraph${i}`]);
  }
  return paragraphs;
}

type Props = {
  category: string;
  title: string;
  image: any;
  author: string;
  authorImg: any;
  jobtitle: string;
  date: string;
  article: any;
};

export default function ArticleTemplate({ category, title, image, author, authorImg, jobtitle, date, article }: Props) {
  const paragraphs = generateParagraphs(article);

  return (
    <ScrollView className="w-full" showsVerticalScrollIndicator={false}>
      <View className="items-center pt-6 pb-5 bg-black/30">
        {/* The cover art is a tall poster graphic (title baked in by the
            artist), not a landscape photo - respecting its native aspect
            ratio instead of cropping it into a wide banner. The dynamic
            title is overlaid at the bottom over a steep, near-opaque
            gradient so it stays readable regardless of what's underneath. */}
        <View
          style={{
            width: "62%",
            aspectRatio: 828 / 1380,
            borderRadius: 18,
            overflow: "hidden",
            ...Platform.select({
              ios: { shadowColor: "#af1222", shadowOpacity: 0.35, shadowRadius: 20, shadowOffset: { width: 0, height: 10 } },
              android: { elevation: 10 },
            }),
          }}
        >
          <Image source={image} className="w-full h-full" resizeMode="cover" />
          <LinearGradient
            colors={["transparent", "transparent", "rgba(0,0,0,0.6)", "rgba(0,0,0,0.96)"]}
            locations={[0, 0.38, 0.68, 1]}
            className="absolute inset-0 justify-end p-4"
          >
            <View className="self-start bg-brand rounded-full px-2.5 py-1 mb-2">
              <Text className="text-[9px] font-bold tracking-wide text-white">{category.toUpperCase()}</Text>
            </View>
            <Text
              numberOfLines={4}
              style={Platform.select({
                ios: { textShadowColor: "rgba(0,0,0,0.6)", textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4 },
              })}
              className="text-[21px] font-bold text-white leading-[25px]"
            >
              {title}
            </Text>
          </LinearGradient>
        </View>
      </View>

      <View className="px-5">
        <View className="flex-row items-center justify-between border-y border-white/10 py-4">
          <View className="flex-row items-center">
            <Image source={authorImg} className="w-[38px] h-[38px] rounded-full mr-2.5" />
            <View>
              <Text className="text-[13px] font-semibold text-white">{author}</Text>
              <Text className="text-[10px] text-gray-500">{jobtitle}</Text>
            </View>
          </View>
          <Text className="text-[10px] text-gray-500">{date}</Text>
        </View>

        <View className="py-4 gap-4 pb-8">
          {paragraphs.map((p, i) => (
            <Text
              key={i}
              className={i === 0 ? "text-[17px] leading-[26px] text-white font-medium" : "text-[15px] leading-[24px] text-gray-300"}
            >
              {p}
            </Text>
          ))}
        </View>
      </View>
    </ScrollView>
  );
}
