import type { MediaKind } from "@appolo/core/ranking";

export interface ReviewFieldCopy {
  /** Prompt shown in the written-review textarea. */
  reviewPlaceholder: string;
  /** Placeholder and accessible name for the optional photo field. */
  photo: string;
  /** The medium has a character to single out; null hides the field. */
  character: string | null;
  /** Placeholder for the "favourite" collection input. */
  favorite: string;
  /** Label used when the saved collection is displayed on a review. */
  favorites: string;
}

export const REVIEW_FIELD_COPY: Record<MediaKind, ReviewFieldCopy> = {
  movie: {
    reviewPlaceholder: "“One of the greatest movies of the year...”",
    photo: "Scene still URL (optional)",
    character: "Favorite character",
    favorite: "Favorite scene",
    favorites: "Favourite scenes",
  },
  tv: {
    reviewPlaceholder: "“The best season of television this year...”",
    photo: "Episode still URL (optional)",
    character: "Favorite character",
    favorite: "Favorite episode",
    favorites: "Favourite episodes",
  },
  music: {
    reviewPlaceholder: "“An album I keep coming back to...”",
    photo: "Album art URL (optional)",
    character: null,
    favorite: "Favorite track",
    favorites: "Favourite tracks",
  },
  podcast: {
    reviewPlaceholder: "“An episode I couldn’t stop thinking about...”",
    photo: "Episode artwork URL (optional)",
    character: null,
    favorite: "Favorite episode",
    favorites: "Favourite episodes",
  },
  book: {
    reviewPlaceholder: "“A book I couldn’t put down...”",
    photo: "Cover image URL (optional)",
    character: "Favorite character",
    favorite: "Favorite quote",
    favorites: "Favourite quotes",
  },
  game: {
    reviewPlaceholder: "“A game I couldn’t stop playing...”",
    photo: "Screenshot URL (optional)",
    character: "Favorite character",
    favorite: "Favorite moment",
    favorites: "Favourite moments",
  },
};
