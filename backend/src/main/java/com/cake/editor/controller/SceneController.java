package com.cake.editor.controller;

import com.cake.editor.model.SceneResponse;
import com.cake.editor.model.SceneSaveRequest;
import com.cake.editor.model.StoredScene;
import com.cake.editor.service.SceneStorageService;
import jakarta.validation.Valid;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping(path = "/api", produces = MediaType.APPLICATION_JSON_VALUE)
public class SceneController {

    private final SceneStorageService sceneStorageService;

    public SceneController(SceneStorageService sceneStorageService) {
        this.sceneStorageService = sceneStorageService;
    }

    @PostMapping(path = "/saveScene", consumes = MediaType.APPLICATION_JSON_VALUE)
    public SceneResponse saveScene(@Valid @RequestBody SceneSaveRequest request) {
        StoredScene saved = sceneStorageService.save(request);
        return mapToResponse(saved);
    }

    @GetMapping("/scene/{id}")
    public SceneResponse getScene(@PathVariable String id) {
        StoredScene storedScene = sceneStorageService.getById(id);
        return mapToResponse(storedScene);
    }

    private SceneResponse mapToResponse(StoredScene scene) {
        SceneResponse response = new SceneResponse();
        response.setId(scene.getId());
        response.setName(scene.getName());
        response.setDescription(scene.getDescription());
        response.setCreatedAt(scene.getCreatedAt());
        response.setSourceFormat(scene.getSourceFormat());
        response.setScene(scene.getScene());
        response.setConvertedModels(scene.getConvertedModels());
        return response;
    }
}
