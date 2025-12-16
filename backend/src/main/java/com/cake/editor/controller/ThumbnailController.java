package com.cake.editor.controller;

import com.cake.editor.model.CakeProject;
import com.cake.editor.model.User;
import com.cake.editor.repository.CakeProjectRepository;
import com.cake.editor.service.CurrentUserService;
import com.cake.editor.service.ThumbnailService;
import org.springframework.core.io.Resource;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.servlet.support.ServletUriComponentsBuilder;

import java.io.IOException;
import java.net.MalformedURLException;
import java.util.Map;

@RestController
@RequestMapping(path = "/api/projects")
public class ThumbnailController {

    private final CakeProjectRepository projectRepository;
    private final CurrentUserService currentUserService;
    private final ThumbnailService thumbnailService;

    public ThumbnailController(CakeProjectRepository projectRepository,
                               CurrentUserService currentUserService,
                               ThumbnailService thumbnailService) {
        this.projectRepository = projectRepository;
        this.currentUserService = currentUserService;
        this.thumbnailService = thumbnailService;
    }

    @PostMapping(path = "/{id}/thumbnail", consumes = MediaType.MULTIPART_FORM_DATA_VALUE, produces = MediaType.APPLICATION_JSON_VALUE)
    public Map<String, String> uploadThumbnail(@PathVariable Long id, @RequestPart("file") MultipartFile file) {
        User owner = currentUserService.requireCurrentUser();
        CakeProject project = projectRepository.findByIdAndOwner(id, owner)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Project not found"));

        if (file == null || file.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Thumbnail file is required");
        }

        try {
            thumbnailService.saveCakeThumbnail(id, file);
        } catch (IOException exception) {
            throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "Failed to save thumbnail", exception);
        }

        String url = ServletUriComponentsBuilder.fromCurrentContextPath()
                .path(String.format("/api/projects/%d/thumbnail", id))
                .toUriString();
        project.setThumbnailUrl(url);
        projectRepository.save(project);

        return Map.of("thumbnailUrl", url);
    }

  @GetMapping(path = "/{id}/thumbnail", produces = MediaType.IMAGE_PNG_VALUE)
  public ResponseEntity<Resource> getThumbnail(@PathVariable Long id) {
      projectRepository.findById(id)
        .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Project not found"));

      try {
        Resource resource = thumbnailService.loadCakeThumbnail(id);
        if (resource == null || !resource.exists()) {
          throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Thumbnail not found");
        }
        return ResponseEntity.ok().contentType(MediaType.IMAGE_PNG).body(resource);
      } catch (MalformedURLException e) {
        throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "Failed to read thumbnail", e);
      }
    }
}
