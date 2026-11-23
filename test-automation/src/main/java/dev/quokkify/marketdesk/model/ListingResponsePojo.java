package dev.quokkify.marketdesk.model;

import java.util.List;
import java.util.Map;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

// A listing response run as GET /api/hermes/products/{id}/response returns it in latest or active; only the fields
// the tests check are read.
@JsonIgnoreProperties(ignoreUnknown = true)
public record ListingResponsePojo(String id, String status, String stage, List<Probe> probes,
    List<Finding> findings) {

  @JsonIgnoreProperties(ignoreUnknown = true)
  public record Probe(String query, String status, Integer total, Integer firstPageSize, Integer position,
      Integer checked) {
  }

  @JsonIgnoreProperties(ignoreUnknown = true)
  public record Finding(String code, String message, String action, Map<String, Object> evidence) {
  }

  public List<String> findingCodes() {
    return findings.stream().map(Finding::code).toList();
  }
}
