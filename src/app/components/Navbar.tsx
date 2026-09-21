"use client";
import { AnimatePresence, motion } from "framer-motion";
import { useState, useContext, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  SiFramer,
  SiTailwindcss,
  SiReact,
  SiJavascript,
  SiCss3,
} from "react-icons/si";
import { FaRankingStar } from "react-icons/fa6";
import { RiTeamFill } from "react-icons/ri";
import { BiSolidNews } from "react-icons/bi";
import { IoCloseSharp, IoPulseSharp } from "react-icons/io5";
import { AiOutlineOrderedList } from "react-icons/ai";
import {
  FaBars,
  FaHome,
  FaCalendarAlt,
  FaFootballBall,
  FaSearch,
  FaClipboardList,
} from "react-icons/fa";
import { GiScales } from "react-icons/gi";
import { RiTwitterFill } from "react-icons/ri";

import { BsArrowLeftCircleFill } from "react-icons/bs";

import Logo from "../images/Transparent.png";
import Image from "next/image";
import Link from "next/link";
import SelectedLeagueContext from "../context/SelectedLeagueContext";
import ScoreboardNav from "./ScoreboardNav";
import Router from "next/router";
import Themechanger from "./ThemeChanger";
import { LuScale } from "react-icons/lu";

interface MyProps {
  leagueID: string;
  usernameSubmitted: boolean;
}

function NavBar(props: MyProps) {
  const router = useRouter();

  const SideNav = () => {
    const [selected, setSelected] = useState(0);

    return (
      <nav className="hidden  2xl:ml-[80px] xl:fixed left-10 top-0 p-4 text-[13px] xl:flex flex-col items-center  gap-2 h-screen  ">
        <Link href={`/league/${localStorage.getItem("selectedLeagueID")}`}>
          <div className="">
            <Image
              className="ml-10"
              src={Logo}
              alt="logo"
              width={200}
              height={200}
            />
          </div>
        </Link>
        <div className=" h-[46vh] flex flex-col justify-around">
          <Link href={`/league/${localStorage.getItem("selectedLeagueID")}`}>
            <div className="flex items-center w-[90px]">
              <NavItem
                selected={selected === 0}
                id={0}
                setSelected={setSelected}
              >
                <FaHome />
              </NavItem>
              <p className="ml-2">Home</p>
            </div>
          </Link>
          <Link
            href={`/league/${localStorage.getItem(
              "selectedLeagueID"
            )}/articles`}
          >
            <div className="flex items-center w-[90px]">
              <NavItem
                selected={selected === 1}
                id={1}
                setSelected={setSelected}
              >
                <BiSolidNews />
              </NavItem>
              <p className="ml-2">Articles</p>
            </div>
          </Link>

          <Link
            href={`/league/${localStorage.getItem("selectedLeagueID")}/rivalry`}
          >
            <div className="flex items-center w-[90px]">
              <NavItem
                selected={selected === 2}
                id={2}
                setSelected={setSelected}
              >
                <IoPulseSharp />
              </NavItem>
              <p className="ml-2">Rivalry</p>
            </div>
          </Link>
          <Link
            href={`/league/${localStorage.getItem(
              "selectedLeagueID"
            )}/schedule`}
          >
            <div className="flex items-center w-[90px]">
              <NavItem
                selected={selected === 3}
                id={3}
                setSelected={setSelected}
              >
                <FaCalendarAlt />
              </NavItem>
              <p className="ml-2">Schedule</p>
            </div>
          </Link>
          <Link
            href={`/league/${localStorage.getItem(
              "selectedLeagueID"
            )}/standings`}
          >
            <div className="flex items-center w-[90px]">
              <NavItem
                selected={selected === 4}
                id={4}
                setSelected={setSelected}
              >
                <AiOutlineOrderedList />
              </NavItem>
              <p className="ml-2">Standings</p>
            </div>
          </Link>
          <Link
            href={`/league/${localStorage.getItem(
              "selectedLeagueID"
            )}/powerRankings`}
          >
            <div className="flex items-center w-[90px]">
              <NavItem
                selected={selected === 9}
                id={9}
                setSelected={setSelected}
              >
                <FaRankingStar />
              </NavItem>
              <p className="ml-2">Power Rankings</p>
            </div>
          </Link>

          <Link
            href={`/league/${localStorage.getItem(
              "selectedLeagueID"
            )}/leaguemanagers`}
          >
            <div className="flex items-center w-[90px]">
              <NavItem
                selected={selected === 5}
                id={5}
                setSelected={setSelected}
              >
                <RiTeamFill />
              </NavItem>
              <p className="ml-2">League Managers</p>
            </div>
          </Link>
          <Link
            href={`/league/${localStorage.getItem(
              "selectedLeagueID"
            )}/tradeCalculator`}
          >
            <div className="flex items-center w-[90px]">
              <NavItem
                selected={selected === 6}
                id={6}
                setSelected={setSelected}
              >
                <LuScale />
              </NavItem>
              <p className="ml-2">Trade Calculator</p>
            </div>
          </Link>
          <Link
            href={`/league/${localStorage.getItem("selectedLeagueID")}/draft`}
          >
            <div className="flex items-center w-[90px]">
              <NavItem
                selected={selected === 7}
                id={6}
                setSelected={setSelected}
              >
                <FaClipboardList />
              </NavItem>
              <p className="ml-2">Draft</p>
            </div>
          </Link>
          <Link target={"_blank"} href={`https://twitter.com/fantasypulseff`}>
            <div className="flex items-center w-[90px]">
              <NavItem
                selected={selected === 8}
                id={7}
                setSelected={setSelected}
              >
                <RiTwitterFill />
              </NavItem>
              <p className="ml-2">X/Twitter</p>
            </div>
          </Link>
        </div>
      </nav>
    );
  };

  const MobileNav = () => {
    const [showScore, setShowScore] = useState(false);
    const [navbar, setNavbar] = useState(false);

    const handleLinkClick = () => {
      setNavbar(false);

      setTimeout(() => {
        router.refresh(); // Replace `router` with the appropriate router instance
      }, 1000); // Delay of 1000 milliseconds (1 second)
    };

    return (
      <div className=" bg-[#EDEDED] dark:bg-black px-4 mx-auto w-screen 2xl:hidden opacity-100 ">
        <div className="flex-items-center">
          <div
            className={`mobilenavbar flex items-center justify-between py-3  border-b-[1px] border-[#af1222] border-opacity-20 h-[95px] xl:hidden `}
          >
            <button
              className="xl:hidden  text-[#af1222] rounded-xl outline-none focus:border-gray-400 focus:border cursor-pointer "
              onClick={() => {
                setShowScore(!showScore);
                setNavbar(false);
              }}
            >
              {showScore ? (
                <FaFootballBall size={30} />
              ) : (
                <FaFootballBall
                  size={30}
                  className="focus:border-none active:border-none"
                />
              )}
            </button>
            <div className="xl:hidden">
              <Link
                href={`/league/${localStorage.getItem("selectedLeagueID")}`}
              >
                <Image height={135} width={135} alt="logo" src={Logo} />
              </Link>
            </div>
            {/* HAMBURGER BUTTON FOR MOBILE */}
            <div className="xl:hidden">
              <button
                className=" text-[#af1222] rounded-xl outline-none focus:border-gray-400 focus:border cursor-pointer "
                onClick={() => {
                  setNavbar(!navbar);
                  setShowScore(false);
                }}
              >
                {navbar ? (
                  <IoCloseSharp size={40} className={`scale-125 `} />
                ) : (
                  <FaBars size={30} className={``} />
                )}
              </button>
            </div>
          </div>
        </div>
        {/* {show scores on navbar} */}
        <div>
          <div
            className={
              showScore ? " xl:p-0 block duration-500 ease-in" : "hidden"
            }
          >
            <ScoreboardNav setShowScore={setShowScore} />
          </div>
        </div>
        <div>
          {/* MOBILE NAVBAR */}
          <div
            className={`flex z-50 w-[95vw]  h-screen ${
              navbar ? "block " : "hidden"
            }`}
          >
            <ul className="xl:h-auto xl:hidden mt-10  flex flex-col justify-start">
              <li className="pb-6 hover:bg-[#AF1222] hover:transition hover:ease-in-out hover:rounded ">
                <Link
                  href={`/league/${localStorage.getItem("selectedLeagueID")}`}
                  onClick={() => setNavbar(!navbar)}
                >
                  <span className="text-[18px] flex items-center   xl:text-[14px]">
                    <FaHome size={18} className="mr-1 " /> Home
                  </span>
                </Link>
              </li>

              <li className="pb-6 text-center  hover:bg-[#AF1222]    hover:transition  hover:ease-in-out hover:rounded ">
                <Link
                  href={`/league/${localStorage.getItem(
                    "selectedLeagueID"
                  )}/articles`}
                  onClick={() => setNavbar(!navbar)}
                >
                  <span className="text-[18px]  flex items-center  xl:text-[14px]">
                    <BiSolidNews size={18} className="mr-1 " /> Articles
                  </span>
                </Link>
              </li>
              <li className="pb-6  text-center   hover:bg-[#AF1222]    hover:transition hover:ease-in-out hover:rounded ">
                <Link
                  href={`/league/${localStorage.getItem(
                    "selectedLeagueID"
                  )}/rivalry`}
                  onClick={() => setNavbar(!navbar)}
                >
                  <span className="text-[18px]  flex items-center   xl:text-[14px]">
                    <IoPulseSharp size={18} className="mr-1 " /> Rivalry
                  </span>
                </Link>
              </li>
              <li className="pb-6 text-center    hover:bg-[#AF1222]  hover:transition hover:ease-in-out hover:rounded ">
                <Link
                  href={`/league/${localStorage.getItem(
                    "selectedLeagueID"
                  )}/schedule`}
                  onClick={() => setNavbar(!navbar)}
                >
                  <span className="text-[18px]  flex items-center xl:text-[14px]">
                    <FaCalendarAlt size={18} className="mr-1 " /> Schedule
                  </span>
                </Link>
              </li>
              <li className="pb-6 text-center    hover:bg-[#AF1222]  hover:transition hover:ease-in-out hover:rounded ">
                <Link
                  href={`/league/${localStorage.getItem(
                    "selectedLeagueID"
                  )}/standings`}
                  onClick={() => setNavbar(!navbar)}
                >
                  <span className="text-[18px]  flex items-center xl:text-[14px]">
                    <AiOutlineOrderedList size={18} className="mr-1 " />{" "}
                    Standings
                  </span>
                </Link>
              </li>
              <li className="pb-6 text-center    hover:bg-[#AF1222]  hover:transition hover:ease-in-out hover:rounded ">
                <Link
                  href={`/league/${localStorage.getItem(
                    "selectedLeagueID"
                  )}/powerRankings`}
                  onClick={() => setNavbar(!navbar)}
                >
                  <span className="text-[18px]  flex items-center xl:text-[14px]">
                    <FaRankingStar size={18} className="mr-1 " /> Power
                    Rankings
                  </span>
                </Link>
              </li>
              <li className="pb-6  text-center   hover:bg-[#AF1222]  hover:transition  hover:ease-in-out hover:rounded ">
                <Link
                  href={`/league/${localStorage.getItem(
                    "selectedLeagueID"
                  )}/leaguemanagers`}
                  onClick={() => setNavbar(!navbar)}
                >
                  <span className="text-[18px]  flex items-center  xl:text-[14px]">
                    <RiTeamFill size={18} className="mr-1 " /> League Managers
                  </span>
                </Link>
              </li>
              <li className="pb-6  text-center   hover:bg-[#AF1222]  hover:transition  hover:ease-in-out hover:rounded ">
                <Link
                  href={`/league/${localStorage.getItem(
                    "selectedLeagueID"
                  )}/draft`}
                  onClick={() => setNavbar(!navbar)}
                >
                  <span className="text-[18px]  flex items-center  xl:text-[14px]">
                    <FaClipboardList size={18} className="mr-1 " /> Draft
                  </span>
                </Link>
              </li>
              <li className="pb-6  text-center   hover:bg-[#AF1222]  hover:transition  hover:ease-in-out hover:rounded ">
                <Link
                  href={`/league/${localStorage.getItem(
                    "selectedLeagueID"
                  )}/tradeCalculator`}
                  onClick={() => setNavbar(!navbar)}
                >
                  <span className="text-[18px]  flex items-center  xl:text-[14px]">
                    <GiScales size={18} className="mr-1 " /> Trade Calculator
                  </span>
                </Link>
              </li>
              <li className="pb-6  text-center   hover:bg-[#AF1222]  hover:transition  hover:ease-in-out hover:rounded ">
                <Link
                  href={`https://twitter.com/fantasypulseff`}
                  onClick={() => setNavbar(!navbar)}
                >
                  <span className="text-[18px]  flex items-center  xl:text-[14px]">
                    <RiTwitterFill size={18} className="mr-1 " /> X/Twitter
                  </span>
                </Link>
              </li>
              <li className="w-full bg-green-300">
                <Themechanger />
              </li>
              <li>
                <div className="flex flex-col items-center justify-center mt-5  gap-y-2">
                  <Link onClick={handleLinkClick} href={"/"}>
                    <BsArrowLeftCircleFill
                      className="text-[#af1222] animate-bounce"
                      size={30}
                    />
                  </Link>
                  <p className="text-[11px] italic">Back to Login Page</p>
                </div>
              </li>
            </ul>
          </div>
        </div>
      </div>
    );
  };

  const NavItem = ({ children, selected, id, setSelected }: any) => {
    return (
      <motion.button
        className="p-3 text-xl dark:bg-[#1a1a1a] bg-[#a39f9f] hover:bg-[#c4bfbf] rounded-full transition-colors relative"
        onClick={() => setSelected(id)}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
      >
        <span className="block relative z-10">{children}</span>
        <AnimatePresence>
          {selected && (
            <motion.span
              className="absolute inset-0 rounded-full bg-[#af1222] z-0"
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0 }}
            ></motion.span>
          )}
        </AnimatePresence>
      </motion.button>
    );
  };

  const usernameSubmitted =
    typeof localStorage !== "undefined"
      ? localStorage.getItem("usernameSubmitted")
      : null;

  if (usernameSubmitted === "false") {
    if (typeof localStorage !== "undefined") {
      localStorage.removeItem("selectedLeagueID");
      localStorage.removeItem("selectedLeagueName");
      localStorage.removeItem("usernameSubmitted");
      localStorage.removeItem("progressValue");
      router.refresh();
    }
  }

  const showNav = () => {
    const handleLinkClick = () => {
      setTimeout(() => {
        router.refresh(); // Replace `router` with the appropriate router instance
      }, 1000); // Delay of 1000 milliseconds (1 second)
    };
    if (
      typeof localStorage !== "undefined" &&
      localStorage.getItem("selectedLeagueID")
    ) {
      return (
        <div className=" flex">
          <div className="flex">
            <div className="hidden xl:flex flex-col items-center justify-center mt-5 ml-5 gap-y-2">
              <Link href={"/"} onClick={handleLinkClick}>
                <BsArrowLeftCircleFill
                  className="text-[#af1222] animate-bounce"
                  size={25}
                />
              </Link>
              <p className="text-[11px] italic">Back to Login Page</p>
            </div>
            <SideNav />
          </div>

          <MobileNav />
        </div>
      );
    } else return <div>{""}</div>;
  };

  useEffect(() => {
    showNav();
  }, [
    typeof localStorage !== "undefined" &&
      localStorage.getItem("selectedLeagueID"),
  ]);

  return <div className="">{showNav()}</div>;
}

export default NavBar;
