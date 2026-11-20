// Input DTO for publishing a listing to its marketplace. Publishing is async: the
// use case validates preconditions and enqueues a publish job; the job finalizes the
// listing (via ListingService) once the marketplace returns an external id.

export interface PublishListingDTO {
  listingId: string;
  // Workspace the listing, its product and its marketplace are loaded in; a foreign id is not found.
  workspaceId: string;
  mode?: 'publish' | 'relist';
  // Actor requesting the publish (for the activity log). Optional for system flows.
  actorId?: string;
  quotaOverride?: {
    confirmed: true;
    reason: string;
  };
}
