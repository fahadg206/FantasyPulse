export default async function handler(req, res) {
  try {
    const welcomeArticle = {
      description:
        "Welcome to Season 2 of Fantasy Pulse – your ultimate destination for fantasy football excellence.",
      title: "Welcome to Fantasy Pulse: Season 2 Kickoff!",
      paragraph1:
        "As the new season kicks off, we are thrilled to welcome you all back to Fantasy Pulse, your one-stop spot for everything fantasy football! Whether you're a seasoned veteran or a rookie manager, our platform is here to enhance your fantasy experience.",
      paragraph2:
        "This year, we're bringing you even more news headlines, in-depth analyses, and a host of useful tools designed to give you the edge in your league. From draft strategies to weekly predictions, we've got it all covered.",
      paragraph3:
        "But that’s not all. Throughout the season, we'll be updating our content regularly to keep you informed and ahead of the competition. Expect fresh insights, timely updates, and the kind of detailed breakdowns that make Fantasy Pulse the go-to resource for fantasy football enthusiasts.",
      paragraph4:
        "We’re also introducing several new features based on your feedback from last season. Your suggestions have been invaluable, and we’re committed to making Fantasy Pulse better than ever. Keep the ideas coming—we’re always looking for ways to improve and expand our offerings.",
      paragraph5:
        "Fantasy Pulse isn’t just about stats and analysis; it’s about building a community. We look forward to hearing from you, whether it's through comments, social media, or direct messages. Your engagement drives us to deliver the best possible experience.",
      paragraph6:
        "As we embark on this new season, we want to extend our heartfelt thanks to all of you for your continued support. It’s your passion for the game that motivates us to keep pushing the envelope, and we can’t wait to see what this season holds.",
      paragraph7:
        "So gear up, dive into the content, and get ready for an exciting ride. Welcome to Season 2 of Fantasy Pulse—where your fantasy football journey begins!",
    };

    // Send the JSON response directly
    res.status(200).json(welcomeArticle);
  } catch (error) {
    console.error("Unexpected error:", error);
    if (!res.headersSent) {
      res.status(500).json({ error: "An error occurred" });
    }
  }
}
