package com.cake.editor.controller;

import com.cake.editor.dto.CakeProjectDetailDto;
import com.cake.editor.dto.CakeProjectSummaryDto;
import com.cake.editor.dto.SaveCakeProjectRequest;
import com.cake.editor.model.CakeProject;
import com.cake.editor.model.User;
import com.cake.editor.repository.CakeProjectRepository;
import com.cake.editor.service.CurrentUserService;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.stream.Collectors;

@RestController
@RequestMapping(path = "/api/projects", produces = MediaType.APPLICATION_JSON_VALUE)
public class CakeProjectController {

    private final CakeProjectRepository projectRepository;
    private final CurrentUserService currentUserService;
    private final DateTimeFormatter formatter = DateTimeFormatter.ISO_INSTANT;

    public CakeProjectController(CakeProjectRepository projectRepository, CurrentUserService currentUserService) {
        this.projectRepository = projectRepository;
        this.currentUserService = currentUserService;
    }

    @GetMapping
    public List<CakeProjectSummaryDto> list() {
        User owner = currentUserService.requireCurrentUser();
        return projectRepository.findAllByOwnerOrderByUpdatedAtDesc(owner)
                .stream()
                .map(this::toSummaryDto)
                .collect(Collectors.toList());
    }

    @GetMapping("/{id}")
    public CakeProjectDetailDto get(@PathVariable Long id) {
        User owner = currentUserService.requireCurrentUser();
        CakeProject project = projectRepository.findByIdAndOwner(id, owner)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Project not found"));
        return toDetailDto(project);
    }

    @PostMapping(consumes = MediaType.APPLICATION_JSON_VALUE)
    public CakeProjectDetailDto create(@Valid @RequestBody SaveCakeProjectRequest request) {
        User owner = currentUserService.requireCurrentUser();

        CakeProject project = new CakeProject();
        project.setOwner(owner);
        project.setName(request.getName());
        project.setDataJson(request.getDataJson());
        projectRepository.save(project);

        return toDetailDto(project);
    }

    @PutMapping(path = "/{id}", consumes = MediaType.APPLICATION_JSON_VALUE)
    public CakeProjectDetailDto update(@PathVariable Long id, @Valid @RequestBody SaveCakeProjectRequest request) {
        User owner = currentUserService.requireCurrentUser();
        CakeProject project = projectRepository.findByIdAndOwner(id, owner)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Project not found"));

        project.setName(request.getName());
        project.setDataJson(request.getDataJson());
        projectRepository.save(project);

        return toDetailDto(project);
    }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@PathVariable Long id) {
        User owner = currentUserService.requireCurrentUser();
        CakeProject project = projectRepository.findByIdAndOwner(id, owner)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Project not found"));
        projectRepository.delete(project);
    }

    private CakeProjectSummaryDto toSummaryDto(CakeProject project) {
        CakeProjectSummaryDto dto = new CakeProjectSummaryDto();
        dto.setId(project.getId());
        dto.setName(project.getName());
        dto.setCreatedAt(formatter.format(project.getCreatedAt()));
        dto.setUpdatedAt(formatter.format(project.getUpdatedAt()));
        dto.setHasPainting(false);
        return dto;
    }

    private CakeProjectDetailDto toDetailDto(CakeProject project) {
        CakeProjectDetailDto dto = new CakeProjectDetailDto();
        dto.setId(project.getId());
        dto.setName(project.getName());
        dto.setCreatedAt(formatter.format(project.getCreatedAt()));
        dto.setUpdatedAt(formatter.format(project.getUpdatedAt()));
        dto.setDataJson(project.getDataJson());
        return dto;
    }
}
