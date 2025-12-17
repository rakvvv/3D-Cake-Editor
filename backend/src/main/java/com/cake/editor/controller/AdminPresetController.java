package com.cake.editor.controller;

import com.cake.editor.dto.CreateAnchorPresetRequest;
import com.cake.editor.dto.CreateDecoratedCakePresetRequest;
import com.cake.editor.dto.StoredPresetDto;
import com.cake.editor.model.AnchorPresetEntity;
import com.cake.editor.model.DecoratedCakePreset;
import com.cake.editor.repository.AnchorPresetRepository;
import com.cake.editor.repository.DecoratedCakePresetRepository;
import com.cake.editor.service.ThumbnailService;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.util.UUID;
import java.util.Map;

@RestController
@RequestMapping(path = "/api/admin/presets", produces = MediaType.APPLICATION_JSON_VALUE)
public class AdminPresetController {

    private final DecoratedCakePresetRepository decoratedCakePresetRepository;
    private final AnchorPresetRepository anchorPresetRepository;
    private final ThumbnailService thumbnailService;

    public AdminPresetController(DecoratedCakePresetRepository decoratedCakePresetRepository,
                                 AnchorPresetRepository anchorPresetRepository,
                                 ThumbnailService thumbnailService) {
        this.decoratedCakePresetRepository = decoratedCakePresetRepository;
        this.anchorPresetRepository = anchorPresetRepository;
        this.thumbnailService = thumbnailService;
    }

    @PostMapping(path = "/cakes", consumes = MediaType.APPLICATION_JSON_VALUE)
    @ResponseStatus(HttpStatus.CREATED)
    @PreAuthorize("hasRole('ADMIN')")
    public StoredPresetDto createDecoratedCakePreset(@Valid @RequestBody CreateDecoratedCakePresetRequest request) {
        decoratedCakePresetRepository.findByPresetId(request.getPresetId())
                .ifPresent(existing -> { throw new ResponseStatusException(HttpStatus.CONFLICT, "Preset already exists"); });

        DecoratedCakePreset preset = new DecoratedCakePreset();
        preset.setPresetId(resolvePresetId(request.getPresetId()));
        preset.setName(request.getName());
        preset.setDescription(request.getDescription());
        preset.setThumbnailUrl(request.getThumbnailUrl());
        preset.setCakeShape(request.getCakeShape());
        preset.setCakeSize(request.getCakeSize());
        preset.setTiers(request.getTiers());
        preset.setDataJson(request.getDataJson());

        decoratedCakePresetRepository.save(preset);
        return toDto(preset);
    }

    @PostMapping(path = "/anchors", consumes = MediaType.APPLICATION_JSON_VALUE)
    @ResponseStatus(HttpStatus.CREATED)
    @PreAuthorize("hasRole('ADMIN')")
    public StoredPresetDto createAnchorPreset(@Valid @RequestBody CreateAnchorPresetRequest request) {
        anchorPresetRepository.findByPresetId(request.getPresetId())
                .ifPresent(existing -> { throw new ResponseStatusException(HttpStatus.CONFLICT, "Anchor preset already exists"); });

        AnchorPresetEntity preset = new AnchorPresetEntity();
        preset.setPresetId(resolvePresetId(request.getPresetId()));
        preset.setName(request.getName());
        preset.setCakeShape(request.getCakeShape());
        preset.setCakeSize(request.getCakeSize());
        preset.setTiers(request.getTiers());
        preset.setDataJson(request.getDataJson());

        anchorPresetRepository.save(preset);
        return toDto(preset);
    }

    @PutMapping(path = "/anchors/{presetId}", consumes = MediaType.APPLICATION_JSON_VALUE)
    @ResponseStatus(HttpStatus.OK)
    @PreAuthorize("hasRole('ADMIN')")
    public StoredPresetDto updateAnchorPreset(@PathVariable String presetId,
                                              @Valid @RequestBody CreateAnchorPresetRequest request) {
        AnchorPresetEntity preset = anchorPresetRepository.findByPresetId(presetId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Anchor preset not found"));

        preset.setPresetId(presetId.trim());
        preset.setName(request.getName());
        preset.setCakeShape(request.getCakeShape());
        preset.setCakeSize(request.getCakeSize());
        preset.setTiers(request.getTiers());
        preset.setDataJson(request.getDataJson());

        anchorPresetRepository.save(preset);
        return toDto(preset);
    }

    @PostMapping(path = "/cakes/{presetId}/thumbnail", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @ResponseStatus(HttpStatus.CREATED)
    @PreAuthorize("hasRole('ADMIN')")
    public Map<String, String> uploadDecoratedPresetThumbnail(@PathVariable String presetId,
                                                              @RequestParam("file") MultipartFile file) {
        DecoratedCakePreset preset = decoratedCakePresetRepository.findByPresetId(presetId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Preset not found"));
        try {
            thumbnailService.savePresetThumbnail(presetId, file);
            String url = String.format("/api/presets/cakes/%s/thumbnail", presetId);
            preset.setThumbnailUrl(url);
            decoratedCakePresetRepository.save(preset);
            return Map.of("thumbnailUrl", url);
        } catch (IOException e) {
            throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "Failed to store thumbnail", e);
        }
    }

    private String resolvePresetId(String requestedId) {
        String trimmed = requestedId.trim();
        return trimmed.isBlank() ? "preset-" + UUID.randomUUID() : trimmed;
    }

    private StoredPresetDto toDto(DecoratedCakePreset preset) {
        StoredPresetDto dto = new StoredPresetDto();
        dto.setId(preset.getPresetId());
        dto.setName(preset.getName());
        dto.setDescription(preset.getDescription());
        dto.setThumbnailUrl(preset.getThumbnailUrl());
        dto.setCakeShape(preset.getCakeShape());
        dto.setCakeSize(preset.getCakeSize());
        dto.setTiers(preset.getTiers());
        dto.setDataJson(preset.getDataJson());
        return dto;
    }

    private StoredPresetDto toDto(AnchorPresetEntity preset) {
        StoredPresetDto dto = new StoredPresetDto();
        dto.setId(preset.getPresetId());
        dto.setName(preset.getName());
        dto.setCakeShape(preset.getCakeShape());
        dto.setCakeSize(preset.getCakeSize());
        dto.setTiers(preset.getTiers());
        dto.setDataJson(preset.getDataJson());
        return dto;
    }
}
