import { motion } from "framer-motion";
import React, { useState, useEffect } from "react";
import { FiChevronLeft, FiChevronRight } from "react-icons/fi";
import useMeasure from "react-use-measure";
import Link from "next/link";
import weekly_preview_img from "../images/weekly_preview.jpg";
import weekly_recap_img from "../images/week_recap.png";
import predictions_img from "../images/predictions.jpg";

const ARTICLE_WIDTH = 240; // Scaled down
const ARTICLE_HEIGHT = 416; // Scaled down
const ARTICLE_MARGIN = 12; // Scaled down
const ARTICLE_SIZE = ARTICLE_WIDTH + ARTICLE_MARGIN;

const BREAKPOINTS = {
  sm: 640,
  lg: 1024,
};

interface ArticleItem {
  id: number;
  title: string;
  imageUrl: string;
  description: string;
  timeAgo: string;
  link: string; // Add a link field for navigation
}

const weekly_preview = weekly_preview_img.src as unknown as string;
const weekly_recap = weekly_recap_img.src as unknown as string;
const predictions = predictions_img.src as unknown as string;

const defaultArticles: ArticleItem[] = [
  {
    id: 1,
    title: "Weekly Preview",
    imageUrl: weekly_preview,
    description: "Our top picks for the upcoming week.",
    timeAgo: "1 day ago",
    link: "Weekly Preview",
  },
  {
    id: 2,
    title: "Weekly Recap",
    imageUrl: weekly_recap,
    description: "Highlights from the past week.",
    timeAgo: "2 days ago",
    link: "Weekly Recap",
  },
  {
    id: 3,
    title: "Predictions",
    imageUrl: predictions,
    description: "Our predictions for the next games.",
    timeAgo: "3 days ago",
    link: "Predictions",
  },
];

const ArticleCarousel = ({ leagueID }: { leagueID: string }) => {
  const [articleReference, { width: articleWidth }] = useMeasure();
  const [articleOffset, setArticleOffset] = useState(0);
  const [articles, setArticles] = useState<ArticleItem[]>(defaultArticles);
  const [loading, setLoading] = useState(true);
  const [leagueStatus, setLeagueStatus] = useState<string | null>(null);
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
    if (typeof window !== "undefined") {
      setLeagueStatus(localStorage.getItem("leagueStatus"));
    }
  }, []);

  useEffect(() => {
    if (isMounted) {
      const selectedLeagueID = localStorage.getItem("selectedLeagueID");
      if (!selectedLeagueID) {
        window.location.href = "/";
      }
    }
  }, [isMounted]);

  const fetchDataFromApi = async (endpoint: string, retryCount = 3) => {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        body: leagueID,
      });

      if (!response.ok) {
        throw new Error("Failed to fetch data");
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.error("Error fetching data:", error);

      if (retryCount > 0) {
        return fetchDataFromApi(endpoint, retryCount - 1);
      }

      return null;
    }
  };

  const ARTICLE_CARD_BUFFER =
    articleWidth > BREAKPOINTS.lg ? 3 : articleWidth > BREAKPOINTS.sm ? 2 : 1;
  const CAN_SHIFT_LEFT_ARTICLES = articleOffset < 0;
  const CAN_SHIFT_RIGHT_ARTICLES =
    Math.abs(articleOffset) + articleWidth < ARTICLE_SIZE * articles.length;

  const shiftLeftArticles = () => {
    if (!CAN_SHIFT_LEFT_ARTICLES) {
      return;
    }
    setArticleOffset((pv) => (pv += ARTICLE_SIZE));
  };

  const shiftRightArticles = () => {
    if (!CAN_SHIFT_RIGHT_ARTICLES) {
      return;
    }
    setArticleOffset((pv) => (pv -= ARTICLE_SIZE));
  };

  const ArticleCard = ({
    imageUrl,
    title,
    description,
    timeAgo,
    link, // Add link to ArticleCard props
  }: ArticleItem) => {
    return (
      <Link
        href={`/league/${localStorage.getItem(
          "selectedLeagueID"
        )}/articles?scrollTo=${link}`}
        scroll={false}
      >
        {" "}
        {/* Wrap the card with Link */}
        <div
          className="relative shrink-0 cursor-pointer rounded-2xl bg-white shadow-md transition-all hover:scale-[1.015] hover:shadow-xl"
          style={{
            width: ARTICLE_WIDTH,
            height: ARTICLE_HEIGHT,
            marginRight: ARTICLE_MARGIN,
            backgroundImage: `url(${imageUrl})`,
            backgroundPosition: "center",
            backgroundSize: "cover",
          }}
        >
          <div className="absolute inset-0 z-20 rounded-2xl bg-gradient-to-t from-black/90 via-black/60 to-black/0 p-6 text-white transition-[backdrop-filter] hover:backdrop-blur-sm flex flex-col justify-end">
            <span className="text-xs font-semibold uppercase text-[#e45263]">
              {timeAgo}
            </span>
            <p className="my-2 text-xl font-bold ">{title}</p>
            <p className="text-[13px] text-slate-300 ">{description}</p>
          </div>
        </div>
      </Link>
    );
  };

  const scaledStyle = {
    transform: "scale(0.75)", // Change the scale value as needed
    transformOrigin: "top left",
  };

  return (
    <section className="w-[95vw] xl:w-[60vw]" ref={articleReference}>
      <div className="relative overflow-hidden p-4">
        <div className="mx-auto max-w-6xl">
          <p className="mb-4 text-lg md:text-xl font-semibold text-center md:text-start">
            Featured Stories
          </p>
          <motion.div
            style={scaledStyle}
            animate={{ x: articleOffset }}
            className="flex"
          >
            {articles.map((item) => {
              return <ArticleCard key={item.id} {...item} />;
            })}
          </motion.div>
        </div>
        <>
          {CAN_SHIFT_LEFT_ARTICLES && (
            <motion.button
              initial={false}
              animate={{
                x: CAN_SHIFT_LEFT_ARTICLES ? "0%" : "-100%",
              }}
              className="absolute left-0 top-[60%] z-30 rounded-r-xl bg-slate-100/30 p-3 pl-2 text-4xl text-black dark:text-white backdrop-blur-sm transition-[padding] hover:pl-3 opacity-40"
              onClick={shiftLeftArticles}
            >
              <FiChevronLeft />
            </motion.button>
          )}
          {CAN_SHIFT_RIGHT_ARTICLES && (
            <motion.button
              initial={false}
              animate={{
                x: CAN_SHIFT_RIGHT_ARTICLES ? "0%" : "100%",
              }}
              className="absolute right-0 top-[60%] z-30 rounded-l-xl bg-slate-100/30 p-3 pr-2 text-4xl text-black dark:text-white backdrop-blur-sm transition-[padding] hover:pr-3 opacity-40"
              onClick={shiftRightArticles}
            >
              <FiChevronRight />
            </motion.button>
          )}
        </>
      </div>
    </section>
  );
};

export default ArticleCarousel;
